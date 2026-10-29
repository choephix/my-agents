import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PaseoAgent as Agent, PaseoApi } from "@getpaseo/client";
import { z } from "zod";
import {
  type ChatSummary, type Op, type OpKind, type Outcome, type TreeState,
  treeCancel, treeChats, treeDismiss, treeGoto, treeOpenTab, treeState, treeSummarize, treeSummary,
} from "./shared/tree";
import { DEFAULT_DISPLAY, displaySettings } from "./shared/settings";
import { entriesOf, readEntries, readLines, SessionTree } from "./server/session-file";
import { awaitResult, cancelRequest, cleanUp, linkRoot, type LinkRequest, loadsExtension, ompHosts, sendRequest, servingPids } from "./server/link";
import { openBranchTab, reloadChat } from "./server/daemon";
import { copyBranch, removeCopy } from "./server/branch-copy";

const UNSUPPORTED: TreeState = { supported: false, ready: false, busy: false, turns: [], branches: [], offer: null, op: null, last: null };
const NOT_LOADED = "This chat's OMP setup does not load the session-tree extension. Add it to ~/.paseo/omp-overlay.yml (see the plugin's OVERVIEW.md).";

/** A session file's derived value, re-read only when the file's size or mtime changed (`read` gets the previous value); concurrent polls share one read. */
interface Cached<T> {
  size: number;
  mtimeMs: number;
  usedAt: number;
  value: Promise<T>;
}

async function cachedRead<T>(cache: Map<string, Cached<T>>, file: string, read: (info: Stats, previous?: Promise<T>) => Promise<T>): Promise<T> {
  const info = await stat(file);
  let entry = cache.get(file);
  if (!entry || entry.size !== info.size || entry.mtimeMs !== info.mtimeMs) {
    const value = read(info, entry?.value);
    entry = { size: info.size, mtimeMs: info.mtimeMs, usedAt: 0, value };
    cache.set(file, entry);
    value.catch(() => cache.get(file)?.value === value && cache.delete(file));
  }
  entry.usedAt = Date.now();
  return entry.value;
}

/** Session files parse one at a time: a cold chat list would otherwise hold every file (~700 MB) in memory at once. */
let parsing: Promise<void> = Promise.resolve();
function parseTree(file: string, previous?: Promise<SessionTree>): Promise<SessionTree> {
  const tree = parsing.then(async () => {
    // OMP appends to its session file: parse only what came after the previous tree's read.
    const read = await readEntries(file, await previous?.catch(() => undefined));
    return new SessionTree(read.entries, read.mark);
  });
  parsing = tree.then(() => undefined, () => undefined); // Holds no tree.
  return tree;
}

/** Full parsed trees, only of chats something opened (state, moves) or being written to; dropped after TREE_IDLE_MS unused. */
const trees = new Map<string, Cached<SessionTree>>();
const TREE_IDLE_MS = 10 * 60_000;

function loadTree(file: string): Promise<SessionTree> {
  return cachedRead(trees, file, (_info, previous) => parseTree(file, previous));
}

interface Offer {
  markerId: string;
  setAside: number;
  summarized: boolean;
  from: string;
  fork: string;
}

/** What the last move left behind (before the user dismissed it): turns that a summary at the branch point would cover. */
function offerIn(tree: SessionTree): Offer | null {
  const marker = tree.currentMarker();
  if (!marker || (marker.data.op === "goto" && marker.data.kind === "undo") || !marker.data.from || !marker.data.fork) return null;
  const setAside = tree.setAside(marker.data.from, marker.data.fork);
  return setAside > 0
    ? { markerId: marker.id, setAside, summarized: marker.data.op === "summarize", from: marker.data.from, fork: marker.data.fork }
    : null;
}

/** The chat list's facts per session file, kept for every chat; the tree they come from is not kept. */
type Facts = { branches: number; offer: Offer | null };
const listFacts = new Map<string, Cached<Facts>>();

/**
 * listFacts also lives on disk, so a restart parses only chats whose file changed instead of all of them
 * (a cold parse of every chat grows the heap to ~400 MB). Bump FACTS_VERSION when what offerIn or
 * branches() report changes, or old facts are served until their chat changes.
 */
const FACTS_VERSION = 1;
const SavedFacts = z.object({
  version: z.literal(FACTS_VERSION),
  files: z.record(z.string(), z.object({
    size: z.number(),
    mtimeMs: z.number(),
    branches: z.number(),
    offer: z.object({ markerId: z.string(), setAside: z.number(), summarized: z.boolean(), from: z.string(), fork: z.string() }).nullable(),
  })),
});
const factsPath = () => join(linkRoot(), "list-facts.json");
let factsLoaded: Promise<void> | undefined;
let factsDirty = false;
let factsSaving: Promise<void> = Promise.resolve();

function loadSavedFacts(): Promise<void> {
  factsLoaded ??= readFile(factsPath(), "utf8").then(text => {
    const saved = SavedFacts.safeParse(JSON.parse(text));
    if (!saved.success) return; // Older version or damaged: parse everything once, then save anew.
    for (const [file, { size, mtimeMs, ...facts }] of Object.entries(saved.data.files)) {
      if (!listFacts.has(file)) listFacts.set(file, { size, mtimeMs, usedAt: 0, value: Promise.resolve(facts) });
    }
  }).catch(() => undefined);
  return factsLoaded;
}

/** Writes listFacts when it changed; saves run one at a time, and each writes the newest state. */
function saveFacts(): Promise<void> {
  if (!factsDirty) return factsSaving;
  factsDirty = false;
  const write = factsSaving.then(async () => {
    const files: z.infer<typeof SavedFacts>["files"] = {};
    for (const [file, entry] of listFacts) {
      const facts = await entry.value.catch(() => undefined);
      if (facts) files[file] = { size: entry.size, mtimeMs: entry.mtimeMs, ...facts };
    }
    const path = factsPath();
    await mkdir(linkRoot(), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify({ version: FACTS_VERSION, files }));
    await rename(`${path}.tmp`, path);
  });
  factsSaving = write.catch(() => undefined);
  return factsSaving;
}

/** Providers that are OMP: `omp` itself and custom providers that extend it (`~/.paseo/config.json`). */
let providerCache: { mtimeMs: number; extendsOf: Record<string, string | undefined> } | undefined;
async function ompProviders(): Promise<(provider: string) => boolean> {
  const file = join(process.env.PASEO_HOME?.replace(/^~(?=\/|$)/, homedir()) || join(homedir(), ".paseo"), "config.json");
  const info = await stat(file).catch(() => undefined);
  if (!info) providerCache = undefined;
  else if (providerCache?.mtimeMs !== info.mtimeMs) {
    try {
      const config = JSON.parse(await readFile(file, "utf8"));
      const providers: Record<string, { extends?: unknown }> = config?.agents?.providers ?? {};
      providerCache = {
        mtimeMs: info.mtimeMs,
        extendsOf: Object.fromEntries(Object.entries(providers).map(([id, value]) => [id, typeof value?.extends === "string" ? value.extends : undefined])),
      };
    } catch {
      // Half-written or broken config: keep what was known, and read it again next time.
    }
  }
  const extendsOf = providerCache?.extendsOf ?? {};
  return provider => {
    let current: string | undefined = provider;
    for (let depth = 0; current && depth < 8; depth++) {
      if (current === "omp") return true;
      current = extendsOf[current];
    }
    return false;
  };
}

function sessionFile(agent: Agent): string | undefined {
  const handle = agent.persistence?.nativeHandle;
  return typeof handle === "string" && handle.endsWith(".jsonl") ? handle : undefined;
}

export default function contribute(server: PluginServerContext) {
  const ops = new Map<string, Op & { requestId?: string }>();
  const outcomes = new Map<string, Outcome>();
  let dismissing: Promise<void> = Promise.resolve();
  const display = server.registerSettings(displaySettings);

  async function supportedAgent(paseo: PaseoApi, agentId: string): Promise<{ agent: Agent; file: string } | undefined> {
    const found = await paseo.agents.ref(agentId).refresh().catch(() => undefined);
    const agent = found?.agent;
    if (!agent || agent.archivedAt || !(await ompProviders())(agent.provider)) return undefined;
    const file = sessionFile(agent);
    return file ? { agent, file } : undefined;
  }

  async function dismissed(agentId: string): Promise<Set<string>> {
    try {
      return new Set(JSON.parse(await readFile(join(linkRoot(), agentId, "dismissed.json"), "utf8")));
    } catch {
      return new Set();
    }
  }

  /** The offer unless the user dismissed it. */
  async function shownOffer(agentId: string, offer: Offer | null): Promise<Offer | null> {
    return offer && !(await dismissed(agentId)).has(offer.markerId) ? offer : null;
  }

  /** The latest finished move per chat, kept until the next one: a client that polled late still learns how its move ended. */
  function lastOutcome(agentId: string): Outcome | null {
    return outcomes.get(agentId) ?? null;
  }

  /**
   * Makes sure the chat's OMP process serves requests. One that started before the extension (or its
   * current REVISION) was installed, or no process at all, is reloaded once. One whose setup never loads the extension
   * fails at once, without reloading the chat for nothing.
   */
  async function ensureServing(agentId: string): Promise<void> {
    const ready = async () => {
      const hosts = await ompHosts(agentId);
      const serving = await servingPids(agentId);
      if (hosts.length && hosts.every(host => serving.has(host.pid))) return true;
      for (const host of hosts) if (!serving.has(host.pid) && !(await loadsExtension(host.env))) throw new Error(NOT_LOADED);
      return false;
    };
    if (await ready()) return;
    await reloadChat(agentId);
    for (const deadline = Date.now() + 10_000; Date.now() < deadline; await sleep(250)) {
      if (await ready()) return;
    }
    throw new Error("This chat's OMP process did not start serving branch moves. Try again, or reload the chat.");
  }

  /** Runs one request against the OMP extension, then reloads the chat so Paseo shows the new path. */
  function startOp(agentId: string, file: string, kind: OpKind, request: LinkRequest, focus?: string): string {
    const summarizing = request.op === "summarize" || !!request.summarize;
    const op: Op & { requestId?: string } = {
      id: `op${Date.now().toString(36)}`, kind, phase: summarizing ? "summarizing" : "switching", startedAt: Date.now(),
      ...(focus ? { focus } : {}),
    };
    // Checked here, in the same tick that takes the slot: a handler that awaited since `prepare` must not start a second move.
    if (ops.has(agentId)) throw new Error("A branch switch is still running.");
    ops.set(agentId, op);
    outcomes.delete(agentId);
    void (async () => {
      let outcome: Outcome["status"] = "error";
      let error: string | undefined;
      try {
        await ensureServing(agentId);
        op.requestId = await sendRequest(agentId, file, request);
        const result = await awaitResult(agentId, op.requestId, {
          claimMs: 10_000,
          totalMs: summarizing ? 15 * 60_000 : 60_000,
        });
        if (result.status === "error") error = result.error;
        else if (result.status === "cancelled") outcome = "cancelled";
        else {
          op.phase = "reloading";
          await reloadChat(agentId);
          outcome = "done";
        }
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      } finally {
        ops.delete(agentId);
        outcomes.set(agentId, { id: op.id, kind, status: outcome, ...(error ? { error } : {}), finishedAt: Date.now() });
        if (op.requestId) await cleanUp(agentId, op.requestId).catch(() => undefined);
      }
    })();
    return op.id;
  }

  async function prepare(paseo: PaseoApi, agentId: string) {
    const found = await supportedAgent(paseo, agentId);
    if (!found) throw new Error("Branches work only in OMP chats.");
    if (found.agent.status === "running") throw new Error("The agent is busy. Try again when it has finished.");
    return { ...found, tree: await loadTree(found.file) };
  }

  server.handle(treeChats, async (_input, { paseo }) => {
    const listed = await paseo.agents.list();
    const isOmp = await ompProviders();
    await loadSavedFacts();
    // Chats the plugin serves (as `supportedAgent` judges); one whose file fails to read this time still counts.
    const served = listed.entries.flatMap(({ agent }) => {
      const file = !agent.archivedAt && isOmp(agent.provider) ? sessionFile(agent) : undefined;
      return file ? [{ agent, file }] : [];
    });
    const rows = await Promise.all(
      served.map(async ({ agent, file }) => {
        if (!agent.workspaceId) return undefined;
        const facts = await cachedRead(listFacts, file, async info => {
          factsDirty = true;
          // A chat written to right now changes again soon: keep its tree, so that only what it appends is parsed.
          const tree = trees.has(file) || Date.now() - info.mtimeMs < 60_000 ? await loadTree(file) : await parseTree(file);
          return { branches: tree.branches().length, offer: offerIn(tree) };
        }).catch(() => undefined);
        if (!facts) return undefined;
        const offer = await shownOffer(agent.id, facts.offer);
        return {
          agentId: agent.id, workspaceId: agent.workspaceId, branches: facts.branches,
          offer: offer?.setAside ?? null, phase: ops.get(agent.id)?.phase ?? null,
        } satisfies ChatSummary;
      }),
    );
    // Forget chats that are gone, and trees nothing has opened for a while.
    const files = new Set(served.map(chat => chat.file));
    const agentIds = new Set(served.map(chat => chat.agent.id));
    for (const file of listFacts.keys()) {
      if (!files.has(file)) {
        listFacts.delete(file);
        factsDirty = true;
      }
    }
    for (const [file, entry] of trees) if (!files.has(file) || Date.now() - entry.usedAt > TREE_IDLE_MS) trees.delete(file);
    for (const agentId of outcomes.keys()) if (!agentIds.has(agentId)) outcomes.delete(agentId);
    void saveFacts();
    const settings = await display.read();
    return { chats: rows.filter(row => row !== undefined), display: settings.status === "ready" ? settings.values : DEFAULT_DISPLAY };
  });

  server.handle(treeState, async ({ agentId }, { paseo }) => {
    const found = await supportedAgent(paseo, agentId);
    if (!found) return UNSUPPORTED;
    const tree = await loadTree(found.file);
    const serving = await servingPids(agentId);
    const offer = await shownOffer(agentId, offerIn(tree));
    const op = ops.get(agentId);
    return {
      supported: true,
      ready: serving.size > 0,
      busy: found.agent.status === "running",
      turns: tree.turns(),
      branches: tree.branches(),
      offer: offer && { markerId: offer.markerId, setAside: offer.setAside, summarized: offer.summarized },
      op: op ? { id: op.id, kind: op.kind, phase: op.phase, startedAt: op.startedAt, ...(op.focus ? { focus: op.focus } : {}) } : null,
      last: lastOutcome(agentId),
    };
  });

  server.handle(treeGoto, async ({ agentId, target, kind, summarize }, { paseo }) => {
    const { file, tree } = await prepare(paseo, agentId);
    let to = target;
    if (kind === "undo") {
      const marker = tree.currentMarker();
      if (!marker?.data.from) throw new Error("Nothing to undo.");
      to = marker.data.from;
    }
    if (!to || !tree.byId.has(to)) throw new Error("That message is not in this chat any more.");
    if (to === tree.leafId) throw new Error("The chat is already there.");
    return { opId: startOp(agentId, file, kind, { op: "goto", target: to, kind, ...(summarize && kind !== "undo" ? { summarize: true } : {}) }) };
  });

  server.handle(treeSummarize, async ({ agentId, focus }, { paseo }) => {
    const { file, tree } = await prepare(paseo, agentId);
    const offer = await shownOffer(agentId, offerIn(tree));
    if (!offer) throw new Error("A message was sent after going back, so there is nothing to summarize at the branch point.");
    if (offer.summarized) throw new Error("What you left is already summarized.");
    const trimmed = focus.trim();
    return { opId: startOp(agentId, file, "summarize", { op: "summarize", from: offer.from, fork: offer.fork, focus: trimmed }, trimmed) };
  });

  server.handle(treeCancel, async ({ agentId }) => {
    const op = ops.get(agentId);
    if (op?.phase !== "summarizing" || !op.requestId) throw new Error("Only a running summary can be cancelled.");
    await cancelRequest(agentId, op.requestId);
    return {};
  });

  server.handle(treeDismiss, async ({ agentId }, { paseo }) => {
    const found = await supportedAgent(paseo, agentId);
    if (!found) return {};
    const marker = (await loadTree(found.file)).currentMarker();
    if (!marker) return {};
    // One dismissal at a time: two clients must not both read the old list and drop each other's id.
    const write = dismissing.then(async () => {
      const ids = [...(await dismissed(agentId)), marker.id].slice(-50);
      const path = join(linkRoot(), agentId, "dismissed.json");
      await mkdir(join(linkRoot(), agentId), { recursive: true });
      await writeFile(`${path}.tmp`, JSON.stringify(ids));
      await rename(`${path}.tmp`, path);
    });
    dismissing = write.catch(() => undefined);
    await write;
    return {};
  });

  server.handle(treeOpenTab, async ({ agentId, entryId, before }, { paseo }) => {
    const found = await supportedAgent(paseo, agentId);
    if (!found) throw new Error("Branches work only in OMP chats.");
    const { agent, file } = found;
    const lines = await readLines(file);
    const tree = new SessionTree(entriesOf(lines));
    const until = before ? tree.byId.get(entryId)?.parentId : entryId;
    if (!until) throw new Error("There is nothing before the first message to open.");
    const copy = await copyBranch(file, lines, tree, until);
    const thinkingOptionId = agent.thinkingOptionId ?? agent.effectiveThinkingOptionId;
    try {
      return {
        agentId: await openBranchTab({
          request: {
            providerId: agent.provider, providerHandleId: copy, cwd: agent.cwd,
            ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
            labels: { "paseo.parent-agent-id": agent.id, "session-tree.from-entry": entryId },
          },
          name: `${(agent.title?.trim() || "Chat").replace(/ · branch$/, "").slice(0, 60)} · branch`,
          config: {
            modelId: agent.model, thinkingOptionId: thinkingOptionId ?? null,
            ...(agent.currentModeId ? { modeId: agent.currentModeId } : {}),
            featureValues: Object.fromEntries((agent.features ?? []).map(feature => [feature.id, feature.value])),
          },
        }),
      };
    } catch (error) {
      // Never leave an orphan copy behind (the helper archives a half-configured tab).
      await removeCopy(copy);
      throw error;
    }
  });

  server.handle(treeSummary, async ({ agentId, callId }, { paseo }) => {
    const found = await supportedAgent(paseo, agentId);
    if (!found) return { summary: null, focus: null };
    const tree = await loadTree(found.file);
    let entry = tree.replayedFallback(callId);
    if (entry?.type !== "branch_summary") {
      // The row numbering did not line up; with one summary on the path there is no doubt.
      const summaries = tree.path(tree.leafId).filter(step => step.type === "branch_summary");
      entry = summaries.length === 1 ? summaries[0] : undefined;
    }
    if (!entry || typeof entry.summary !== "string") return { summary: null, focus: null };
    const marker = tree.markers().find(step => step.data.op === "summarize" && step.data.summaryId === entry.id);
    const focus = marker?.data.op === "summarize" && marker.data.focus ? marker.data.focus : null;
    return { summary: entry.summary, focus };
  });

  return () => {};
}
