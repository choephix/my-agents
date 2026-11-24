import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import path from "node:path";
import type { linksForAgent, linksForWorkspace, WorkspaceTab } from "../shared/links";
import { TailFold } from "./cache";
import { addProse, listLinks, siteFor, subagentLinks, type LinkMap } from "./links";
import { agentTranscripts, findSubagents, harnessSubagents, type SubagentTranscript } from "./subagents";
import { findTranscript, type ProseReader, type Transcript } from "./transcripts";
import type { WatchTargets } from "./watcher";
import { workspaceTree, type TabAgents } from "./workspace";

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

export interface DetailedResult<T> {
  result: T;
  targets: WatchTargets;
}

export interface LinksService {
  forAgent(input: RpcInput<typeof linksForAgent>, paseo: PaseoApi): Promise<RpcOutput<typeof linksForAgent>>;
  forAgentDetailed(input: RpcInput<typeof linksForAgent>, paseo: PaseoApi): Promise<DetailedResult<RpcOutput<typeof linksForAgent>>>;
  forWorkspace(input: RpcInput<typeof linksForWorkspace>, paseo: PaseoApi): Promise<RpcOutput<typeof linksForWorkspace>>;
  forWorkspaceDetailed(input: RpcInput<typeof linksForWorkspace>, paseo: PaseoApi): Promise<DetailedResult<RpcOutput<typeof linksForWorkspace>>>;
}

/** The directory where a transcript's harness sub-agents live, if that harness has one. */
function subagentDirOf(transcript: Transcript | null): string | null {
  const folder = transcript?.file.replace(/\.jsonl$/, "");
  if (!folder) return null;
  if (transcript?.kind === "omp") return folder;
  if (transcript?.kind === "claude") return path.join(folder, "subagents");
  return null;
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

  async function forAgentDetailed(
    { agentId, subagents }: RpcInput<typeof linksForAgent>,
    paseo: PaseoApi,
  ): Promise<DetailedResult<RpcOutput<typeof linksForAgent>>> {
    const files = new Set<string>();
    const dirs = new Set<string>();
    const handle = paseo.agents.ref(agentId);
    // fetch_agent reads the live or stored record; unlike a timeline fetch it never loads the agent.
    const agent = (await handle.refresh())?.agent;
    if (!agent) return { result: { source: "none", links: [] }, targets: { files, dirs } };
    const transcript = await findTranscript(agent, home);
    if (transcript) files.add(transcript.file);
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
    if (!subagents) return { result: { source, links: listLinks(links) }, targets: { files, dirs } };
    const subDir = subagentDirOf(transcript);
    if (subDir) dirs.add(subDir);
    const found = await findSubagents(agentId, transcript, paseo, home);
    for (const sub of found) files.add(sub.file);
    const read = await readSubagents(found);
    return { result: { source, links: listLinks(links), subagentLinks: subagentLinks(links, read) }, targets: { files, dirs } };
  }

  async function forAgent(input: RpcInput<typeof linksForAgent>, paseo: PaseoApi): Promise<RpcOutput<typeof linksForAgent>> {
    return (await forAgentDetailed(input, paseo)).result;
  }

  /**
   * Each workspace's tabs as last listed. Listing them pages through every agent record (616 today:
   * ~40 ms and 1.2 MB per call), so a transcript-change push reuses them; a new, closed or renamed
   * tab refreshes the tree.
   */
  const trees = new Map<string, TabAgents<PaseoAgent>[]>();

  /**
   * Every tab of the workspace, closed ones included, with its own links and (asked for) what its
   * sub-agents added: its harness sub-agents plus the Paseo agents folded into it. A tab whose
   * transcript can't be read lists no links.
   */
  async function forWorkspaceDetailed(
    { workspaceId, subagents, poll }: RpcInput<typeof linksForWorkspace>,
    paseo: PaseoApi,
  ): Promise<DetailedResult<RpcOutput<typeof linksForWorkspace>>> {
    const files = new Set<string>();
    const dirs = new Set<string>();
    const tree = (poll && trees.get(workspaceId)) || workspaceTree(await listAllAgents(paseo), workspaceId);
    trees.set(workspaceId, tree);
    const tabs = await inBatches(tree, async ({ root, children }): Promise<WorkspaceTab> => {
      const transcript = await findTranscript(root, home);
      const closed = !!root.archivedAt;
      if (!closed && transcript) files.add(transcript.file);
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
        closed,
        // Every URL link carries its variants, so the page can merge them across tabs (`client/workspace.ts`).
        links: listLinks(links, true),
      };
      if (!subagents) return tab;
      if (!closed) {
        const subDir = subagentDirOf(transcript);
        if (subDir) dirs.add(subDir);
      }
      const [own, folded] = await Promise.all([harnessSubagents(transcript), agentTranscripts(children, home)]);
      if (!closed) {
        for (const sub of own) files.add(sub.file);
      }
      for (let i = 0; i < children.length; i++) {
        // Watch transcripts of open Paseo children even if their root is closed, though normally both match.
        if (children[i].archivedAt) continue;
        const found = await findTranscript(children[i], home);
        if (found) files.add(found.file);
      }
      return { ...tab, subagentLinks: subagentLinks(links, await readSubagents([...own, ...folded]), true) };
    });
    return { result: { tabs }, targets: { files, dirs } };
  }

  async function forWorkspace(input: RpcInput<typeof linksForWorkspace>, paseo: PaseoApi): Promise<RpcOutput<typeof linksForWorkspace>> {
    return (await forWorkspaceDetailed(input, paseo)).result;
  }

  return { forAgent, forAgentDetailed, forWorkspace, forWorkspaceDetailed };
}
