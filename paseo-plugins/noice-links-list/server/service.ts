import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { linksForAgent, linksForWorkspace, WorkspaceTab } from "../shared/links";
import { TailFold } from "./cache";
import { addProse, listLinks, siteFor, subagentLinks, type LinkMap } from "./links";
import { agentTranscripts, findSubagents, harnessSubagents, type SubagentTranscript } from "./subagents";
import { findTranscript, type ProseReader } from "./transcripts";
import { workspaceTree } from "./workspace";

/** Transcripts read at once; a session can have hundreds of sub-agents, a workspace dozens of tabs. */
const BATCH = 16;

/** `fn` over `items`, at most BATCH at a time; results keep the order of `items`. */
async function inBatches<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += BATCH) out.push(...(await Promise.all(items.slice(start, start + BATCH).map(fn))));
  return out;
}

/** Every agent record, archived ones included (the daemon pages at 200). */
async function listAllAgents(paseo: PaseoApi): Promise<PaseoAgent[]> {
  const all: PaseoAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({ filter: { includeArchived: true }, page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    all.push(...page.entries.map(({ agent }) => agent));
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return all;
}

export interface LinksService {
  forAgent(input: RpcInput<typeof linksForAgent>, paseo: PaseoApi): Promise<RpcOutput<typeof linksForAgent>>;
  forWorkspace(input: RpcInput<typeof linksForWorkspace>, paseo: PaseoApi): Promise<RpcOutput<typeof linksForWorkspace>>;
}

/**
 * `links.for-agent` and `links.for-workspace`, sharing one incremental cache per transcript file.
 * omp/claude/codex chats are read from their transcript (only the appended bytes after the first
 * request). For other providers the chat endpoint uses the daemon timeline: the client asks only
 * for chats on screen, which the daemon already has loaded, so the fetch never resumes an agent.
 * The workspace endpoint covers many chats that may not be loaded, so it reads transcripts only.
 * Sub-agents are read from their transcripts only, never through the timeline.
 */
export function createLinksService(home: string, webshareOrigin = "", webshareFolder?: string): LinksService {
  const site = siteFor(home, webshareOrigin, webshareFolder);
  const transcripts = new TailFold<LinkMap>(() => new Map());
  const fold = (file: string, read: ProseReader) =>
    transcripts.read(file, (acc, line) => {
      const prose = read(line);
      if (prose) addProse(acc, prose, site);
    });
  /** Each readable sub-agent transcript's links; unreadable ones are skipped. */
  const readSubagents = async (found: readonly SubagentTranscript[]) => {
    const folded = await inBatches(found, ({ file, read }) => fold(file, read).catch(() => null));
    return found.flatMap(({ name }, index) => {
      const links = folded[index];
      return links ? [{ name, links }] : [];
    });
  };

  async function forAgent({ agentId, subagents }: RpcInput<typeof linksForAgent>, paseo: PaseoApi): Promise<RpcOutput<typeof linksForAgent>> {
    const handle = paseo.agents.ref(agentId);
    // fetch_agent reads the live or stored record; unlike a timeline fetch it never loads the agent.
    const agent = (await handle.refresh())?.agent;
    if (!agent) return { source: "none", links: [] };
    const transcript = await findTranscript(agent, home);
    let source: "transcript" | "timeline" = "transcript";
    let links: LinkMap | null = null;
    if (transcript) {
      try {
        links = await fold(transcript.file, transcript.read);
      } catch (error) {
        console.warn(`[noice-links-list] reading ${transcript.file} failed; using the timeline`, error);
      }
    }
    if (!links) {
      source = "timeline";
      links = new Map();
      const page = await handle.timeline.refetch({ direction: "tail", limit: 0 });
      for (const { item, timestamp } of page.entries) {
        if (item.type !== "user_message" && item.type !== "assistant_message") continue;
        addProse(links, { role: item.type === "user_message" ? "user" : "assistant", text: item.text, at: Date.parse(timestamp) }, site);
      }
    }
    if (!subagents) return { source, links: listLinks(links) };
    const read = await readSubagents(await findSubagents(agentId, transcript, paseo, home));
    return { source, links: listLinks(links), subagentLinks: subagentLinks(links, read) };
  }

  /**
   * Every tab of the workspace, closed ones included, with its own links and (asked for) what its
   * sub-agents added: its harness sub-agents plus the Paseo agents folded into it. A tab whose
   * transcript can't be read lists no links.
   */
  async function forWorkspace(
    { workspaceId, subagents }: RpcInput<typeof linksForWorkspace>,
    paseo: PaseoApi,
  ): Promise<RpcOutput<typeof linksForWorkspace>> {
    const tree = workspaceTree(await listAllAgents(paseo), workspaceId);
    const tabs = await inBatches(tree, async ({ root, children }): Promise<WorkspaceTab> => {
      const transcript = await findTranscript(root, home);
      let links: LinkMap = new Map();
      if (transcript) {
        try {
          links = await fold(transcript.file, transcript.read);
        } catch (error) {
          console.warn(`[noice-links-list] reading ${transcript.file} failed`, error);
        }
      }
      const tab: WorkspaceTab = {
        agentId: root.id,
        title: root.title || root.id.slice(0, 8),
        provider: root.provider,
        closed: !!root.archivedAt,
        // Every URL link carries its variants, so the page can merge them across tabs (`client/workspace.ts`).
        links: listLinks(links, true),
      };
      if (!subagents) return tab;
      const [own, folded] = await Promise.all([harnessSubagents(transcript), agentTranscripts(children, home)]);
      return { ...tab, subagentLinks: subagentLinks(links, await readSubagents([...own, ...folded]), true) };
    });
    return { tabs };
  }

  return { forAgent, forWorkspace };
}
