import type { PluginHookAgent, PluginServerContext, PluginSettings } from "@getpaseo/plugin/server";
import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import { isDelegatedAgent } from "@getpaseo/protocol/agent-labels";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { retitleWorkspace, type RetitleResult } from "../shared/rpc";
import type { settings } from "../shared/settings";
import { conversationContext, readable } from "../shared/agent-titles.mjs";
import { firstAgent, observeTitle, projectEntry, splitWorkspaces, workspaceOwnership } from "../shared/workspace-titles.mjs";
import { decideWorkspaceTitle, modelChoice, type Sibling, type WorkspaceTitleRequest } from "./model";
import { DATA_DIR } from "./rename";
import { openingPromptLines, openingTimeline, recentTimeline } from "./timeline";
import { listAgents, type ListedAgent } from "./agents";

// Manual retitles avoid the current title and this many earlier ones.
const REJECTED_MEMORY = 5;

// Workspace labels would be visible chips, so ownership lives in Titles' data directory.
const OWNERSHIP_FILE = join(DATA_DIR, "workspaces.json");
const ownershipSchema = z.object({ version: z.literal(1), workspaces: z.record(z.string(), z.string()) });

// The titles a new workspace showed since Titles saw it created (see observeTitle).
type Observed = { createdAt: number; initial?: string | null; changes: { title: string | null; at: number }[] };

// Workspace titles: a new workspace is named once its first tab has a prompt,
// and "Retitle workspace" names any workspace on demand. Returns the cleanup.
export function registerWorkspaceTitles(server: PluginServerContext, preferences: PluginSettings<typeof settings.schema>) {
  const chosen = ownershipFile();
  // Workspaces created while Titles runs that have no title of Titles' yet.
  const pending = new Map<string, Observed>();
  // Workspaces whose first prompt Haiku has seen; a later turn_ended needn't ask again.
  const asked = new Set<string>();
  // First-prompt lines per workspace (its first tab's opening prompts); a first prompt never changes.
  const placeholders = new Map<string, Promise<string[]>>();
  const rejected = new Map<string, string[]>();
  const busy = new Set<string>();
  let watching: Promise<() => void> | null = null;
  let disposed = false;

  const exclusive = async <T>(workspaceId: string, work: () => Promise<T>) => {
    if (busy.has(workspaceId)) throw new Error("Already retitling this workspace");
    busy.add(workspaceId);
    try { return await work(); } finally { busy.delete(workspaceId); }
  };
  const forget = (workspaceId: string) => { pending.delete(workspaceId); asked.delete(workspaceId); rejected.delete(workspaceId); placeholders.delete(workspaceId); };
  const see = (workspace: Pick<PaseoWorkspace, "id" | "title">) => {
    const observed = pending.get(workspace.id);
    if (observed) pending.set(workspace.id, observeTitle(observed, workspace.title ?? null, Date.now()));
  };

  // Title changes of pending workspaces, to tell Paseo's generated title from a
  // hand rename. The API only exists in hook and RPC contexts, so the
  // subscription starts with the first workspace created and lasts until cleanup.
  const watchTitles = (paseo: PaseoApi) => {
    watching ??= (async () => {
      const { entries, subscription } = await paseo.workspaces.list({ subscribe: {} });
      entries.forEach(see);
      const stop = subscription.subscribe({
        snapshot: snapshot => snapshot.entries.forEach(see),
        update: message => {
          if (message.type !== "workspace_update") return;
          if (message.payload.kind === "upsert") see(message.payload.workspace);
          else forget(message.payload.id);
        },
        error: error => console.warn("noice-titles: workspace title updates failed:", error instanceof Error ? error.message : error),
      });
      return () => { stop(); subscription.release().catch(() => {}); };
    })().catch(error => {
      watching = null;
      console.warn("noice-titles: workspace title updates unavailable:", error instanceof Error ? error.message : error);
      return () => {};
    });
  };

  // The workspace's earliest tab (archived ones included) whose history can be read
  // without starting it: reading a stored live agent would resume its provider.
  const firstTab = (agents: ListedAgent[], workspaceId: string) =>
    firstAgent(agents, workspaceId, (agent: ListedAgent) => !agent.internal && !isDelegatedAgent(agent) && readable(agent));

  // `agents` is read only when the workspace's lines aren't cached yet.
  const placeholderLines = (paseo: PaseoApi, workspaceId: string, agents: () => Promise<ListedAgent[]>) => {
    let lines = placeholders.get(workspaceId);
    if (!lines) {
      lines = agents().then(list => {
        const first = firstTab(list, workspaceId);
        return first ? openingPromptLines(paseo.agents.ref(first.id)) : [];
      });
      placeholders.set(workspaceId, lines);
      // Cache only a found prompt: an empty workspace gets one later.
      lines.then(found => { if (!found.length) placeholders.delete(workspaceId); }, () => placeholders.delete(workspaceId));
    }
    return lines;
  };

  // This project's other workspaces, marked like sibling tabs, and the most
  // recently active ones elsewhere. A failed lookup is logged and titling goes
  // on without them.
  const siblingsOf = async (paseo: PaseoApi, workspace: PaseoWorkspace): Promise<Pick<WorkspaceTitleRequest, "project" | "elsewhere">> => {
    try {
      const { project, elsewhere } = splitWorkspaces(await listWorkspaces(paseo), workspace);
      const mine = await owned();
      let agents: Promise<ListedAgent[]> | undefined;
      const entries = await Promise.all(project.map(async (other: PaseoWorkspace) => {
        const title = mine.get(other.id) ?? null;
        // Only a title that isn't Titles' own needs the first prompt.
        const lines = other.title === title ? [] : await placeholderLines(paseo, other.id, () => agents ??= listAgents(paseo));
        return projectEntry(other.title, title, lines);
      }));
      return { project: entries.filter((entry): entry is Sibling => entry !== null), elsewhere };
    } catch (error) {
      console.warn(`noice-titles: siblings of workspace ${workspace.id} unavailable:`, error instanceof Error ? error.message : error);
      return { project: [], elsewhere: [] };
    }
  };

  // The ownership file read never blocks titling: unreadable, it counts as empty,
  // which treats Titles' earlier titles as hand-named (left alone, noted for Haiku).
  const owned = () => chosen.all().catch(error => {
    console.warn("noice-titles: workspace ownership file unreadable:", error instanceof Error ? error.message : error);
    return new Map<string, string>();
  });
  // Ownership is a nicety for sibling notes; a failed write never undoes a rename.
  const remember = (workspaceId: string, title: string) => chosen.set(workspaceId, title)
    .catch(error => console.warn(`noice-titles: couldn't record workspace ${workspaceId}'s title:`, error instanceof Error ? error.message : error));

  const offCreated = server.on("workspace.created", ({ workspace }, { paseo }) => {
    pending.set(workspace.id, { createdAt: Date.now(), changes: [] });
    watchTitles(paseo);
    // The record already holds its first title (explicit, first-prompt placeholder or none).
    void paseo.workspaces.ref(workspace.id).refresh().then(current => {
      if (!current || current.background || current.internal) forget(workspace.id);
      else see(current);
    }, error => console.warn(`noice-titles: workspace ${workspace.id} unreadable:`, error instanceof Error ? error.message : error));
  });
  const offArchived = server.on("workspace.archived", ({ workspace }) => forget(workspace.id));

  // A pending workspace is named at the start of a tab's turn, as early as its
  // prompt is readable, so Titles usually lands before Paseo's generated title
  // (which Paseo then drops). If the prompt wasn't readable yet, the turn's end
  // tries once more; a prompt without a subject waits for the next turn.
  const onTurn = (agent: PluginHookAgent, paseo: PaseoApi, start: boolean) => {
    const workspaceId = agent.workspaceId;
    if (!workspaceId || !pending.has(workspaceId) || agent.parentAgentId || busy.has(workspaceId)) return;
    if (!start && asked.has(workspaceId)) return;
    const started = Date.now();
    const run = async (): Promise<string | null> => {
      const state = await preferences.read();
      // An unreadable settings file is passing: keep the workspace pending.
      if (state.status !== "ready") return "settings unreadable; will retry";
      if (!state.values.workspaces) { forget(workspaceId); return "automatic workspace titles are off"; }
      // Paseo's internal agents (its own title generator) and sub-agents never take the lock.
      const handle = paseo.agents.ref(agent.id);
      const snapshot = await handle.refresh();
      if (!snapshot || ("internal" in snapshot.agent && snapshot.agent.internal) || isDelegatedAgent(snapshot.agent) || busy.has(workspaceId)) return null;
      return exclusive(workspaceId, async () => {
        if (!pending.has(workspaceId)) return null; // Named or given up meanwhile.
        const workspace = await paseo.workspaces.ref(workspaceId).refresh();
        if (!workspace) { forget(workspaceId); return null; }
        const conversation = conversationContext(await recentTimeline(handle));
        if (!conversation) return null;
        const lines = await placeholderLines(paseo, workspaceId, () => listAgents(paseo));
        const ownership = async (title: string | null) =>
          workspaceOwnership(title, { chosen: (await owned()).get(workspaceId) ?? null, placeholders: lines, observed: pending.get(workspaceId) ?? null });
        const title = workspace.title ?? null;
        const before = await ownership(title);
        if (before === "hand" || before === "named") { forget(workspaceId); return `left ${before === "hand" ? "hand-named" : "already named"} ${JSON.stringify(title)}`; }
        asked.add(workspaceId);
        const decision = await decideWorkspaceTitle(state.values, "first", { projectName: workspace.projectCustomName || workspace.projectDisplayName, ...await siblingsOf(paseo, workspace), conversation });
        if (disposed) return "plugin stopped";
        if (decision.kind === "keep") return "no subject yet";
        // No conditional rename exists: re-read right before writing. Paseo's
        // generated title may have landed meanwhile; a hand rename stays.
        const now = await paseo.workspaces.ref(workspaceId).refresh();
        if (!now) { forget(workspaceId); return "workspace gone"; }
        const current = now.title ?? null;
        const ownershipNow = current === title ? before : await ownership(current);
        if (ownershipNow === "hand" || ownershipNow === "named") { forget(workspaceId); return `skipped: renamed meanwhile to ${JSON.stringify(current)}`; }
        forget(workspaceId);
        await paseo.workspaces.ref(workspaceId).setTitle(decision.title);
        await remember(workspaceId, decision.title);
        return `${JSON.stringify(current)}${ownershipNow === "paseo" ? " (Paseo's)" : ""} → ${decision.title}`;
      });
    };
    void run().then(
      note => { if (note) console.info(`noice-titles: workspace ${workspaceId} (${start ? "turn start" : "turn end"}): ${note} in ${Date.now() - started} ms`); },
      error => console.warn(`noice-titles: workspace ${workspaceId} failed:`, error instanceof Error ? error.message : error),
    );
  };
  const offTurnStarted = server.on("agent.turn_started", ({ agent }, { paseo }) => onTurn(agent, paseo, true));
  const offTurnEnded = server.on("agent.turn_ended", ({ agent, outcome }, { paseo }) => { if (outcome.kind === "completed") onTurn(agent, paseo, false); });

  // Stefan asked for a new title, so the current one is never kept. Works on any
  // workspace, whatever the setting or who named it.
  server.handle(retitleWorkspace, async ({ workspaceId }, { paseo }) => {
    const started = Date.now();
    const failed = (message: string): RetitleResult => ({ outcome: "failed", message });
    const result = await exclusive(workspaceId, async (): Promise<RetitleResult> => {
      const workspace = await paseo.workspaces.ref(workspaceId).refresh();
      if (!workspace) return failed("This workspace no longer exists");
      const current = workspace.title ?? null;
      const agents = await listAgents(paseo);
      const tabs = agents.filter(agent => agent.workspaceId === workspaceId && !agent.archivedAt && !agent.internal && !isDelegatedAgent(agent))
        .flatMap(agent => agent.title ? [agent.title] : []);
      const first = firstTab(agents, workspaceId);
      const conversation = first ? conversationContext(await openingTimeline(paseo.agents.ref(first.id)).catch(error => {
        console.warn(`noice-titles: first tab of workspace ${workspaceId} unreadable:`, error instanceof Error ? error.message : error);
        return [];
      })) : "";
      // A workspace whose only tab is a side agent still has its own title to go on.
      if (!conversation && !tabs.length && !current) return failed("Nothing to title yet");
      const avoid = [...new Set([current, ...(rejected.get(workspaceId) ?? [])].filter((title): title is string => !!title))];
      const decision = await decideWorkspaceTitle(await modelChoice(preferences), "manual", {
        projectName: workspace.projectCustomName || workspace.projectDisplayName, ...await siblingsOf(paseo, workspace), conversation, tabs, rejected: avoid,
      });
      if (disposed) return failed("Titles was disabled meanwhile");
      if (decision.kind === "keep") return failed("The model found no subject to name");
      // No conditional rename exists: re-read right before writing.
      const now = await paseo.workspaces.ref(workspaceId).refresh();
      if (!now) return failed("This workspace no longer exists");
      if ((now.title ?? null) !== current) return failed("The workspace was renamed meanwhile; that name stays");
      forget(workspaceId);
      await paseo.workspaces.ref(workspaceId).setTitle(decision.title);
      await remember(workspaceId, decision.title);
      rejected.set(workspaceId, avoid.slice(0, REJECTED_MEMORY));
      return { outcome: "renamed", title: decision.title, previous: current };
    }).catch((error): RetitleResult => failed(error instanceof Error ? error.message : String(error)));
    console.info(`noice-titles: retitle workspace ${workspaceId}: ${JSON.stringify(result)} in ${Date.now() - started} ms`);
    return result;
  });

  return () => {
    disposed = true;
    offCreated(); offArchived(); offTurnStarted(); offTurnEnded();
    void watching?.then(stop => stop());
    pending.clear(); asked.clear(); placeholders.clear(); rejected.clear();
  };
}

async function listWorkspaces(paseo: PaseoApi) {
  const all: PaseoWorkspace[] = [];
  for (let cursor: string | undefined; ;) {
    const page = await paseo.workspaces.list(cursor ? { page: { limit: 200, cursor } } : {});
    all.push(...page.entries);
    cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
    if (!cursor) return all;
  }
}

// Workspace id → the title Titles chose, in one JSON file:
// { "version": 1, "workspaces": { "<id>": "<title>" } }. Reads come from memory
// after the first load; writes run one at a time and replace the file atomically.
function ownershipFile() {
  let loaded: Promise<Map<string, string>> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const all = () => loaded ??= readFile(OWNERSHIP_FILE, "utf8").then(
    raw => new Map(Object.entries(ownershipSchema.parse(JSON.parse(raw)).workspaces)),
    (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return new Map<string, string>(); throw error; },
  ).catch(error => { loaded = null; throw error; });
  const set = (workspaceId: string, title: string) => {
    const next = queue.then(async () => {
      const titles = await all();
      titles.set(workspaceId, title);
      await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
      const temporary = `${OWNERSHIP_FILE}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify({ version: 1, workspaces: Object.fromEntries(titles) })}\n`, { mode: 0o600 });
      await rename(temporary, OWNERSHIP_FILE);
    });
    // A failed write must not wedge every later one.
    queue = next.catch(() => undefined);
    return next;
  };
  return { all, set };
}
