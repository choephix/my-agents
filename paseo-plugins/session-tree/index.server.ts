import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PaseoAgent as Agent, PaseoApi } from "@getpaseo/client";
import {
  type ChatSummary, type Op, type OpKind, type Outcome, type TreeState,
  treeCancel, treeChats, treeDismiss, treeGoto, treeOpenTab, treeState, treeSummarize, treeSummary,
} from "./shared/tree";
import { DEFAULT_DISPLAY, displaySettings } from "./shared/settings";
import { readEntries, SessionTree } from "./server/session-file";
import { awaitResult, cancelRequest, cleanUp, linkRoot, type LinkRequest, loadsExtension, ompHosts, sendRequest, servingPids } from "./server/link";
import { connectLocalDaemon, reloadChat } from "./server/daemon";
import { copyBranch, removeCopy } from "./server/branch-copy";

const UNSUPPORTED: TreeState = { supported: false, ready: false, busy: false, turns: [], branches: [], offer: null, op: null, last: null };
const NOT_LOADED = "This chat's OMP setup does not load the session-tree extension. Add it to ~/.paseo/omp-overlay.yml (see the plugin's OVERVIEW.md).";

/** Parsed session files, re-read only when size or mtime changed. */
const trees = new Map<string, { size: number; mtimeMs: number; tree: SessionTree }>();

async function loadTree(file: string): Promise<SessionTree> {
  const info = await stat(file);
  const cached = trees.get(file);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.tree;
  const { entries } = await readEntries(file);
  const tree = new SessionTree(entries);
  trees.set(file, { size: info.size, mtimeMs: info.mtimeMs, tree });
  return tree;
}

/** Providers that are OMP: `omp` itself and custom providers that extend it (`~/.paseo/config.json`). */
let providerCache: { mtimeMs: number; extendsOf: Record<string, string | undefined> } | undefined;
async function isOmp(provider: string): Promise<boolean> {
  const file = join(process.env.PASEO_HOME?.replace(/^~(?=\/|$)/, homedir()) || join(homedir(), ".paseo"), "config.json");
  const info = await stat(file).catch(() => undefined);
  if (info && providerCache?.mtimeMs !== info.mtimeMs) {
    const config = JSON.parse(await readFile(file, "utf8"));
    const providers: Record<string, { extends?: unknown }> = config?.agents?.providers ?? {};
    providerCache = {
      mtimeMs: info.mtimeMs,
      extendsOf: Object.fromEntries(Object.entries(providers).map(([id, value]) => [id, typeof value?.extends === "string" ? value.extends : undefined])),
    };
  }
  let current: string | undefined = provider;
  for (let depth = 0; current && depth < 8; depth++) {
    if (current === "omp") return true;
    current = providerCache?.extendsOf[current];
  }
  return false;
}

function sessionFile(agent: Agent): string | undefined {
  const handle = agent.persistence?.nativeHandle;
  return typeof handle === "string" && handle.endsWith(".jsonl") ? handle : undefined;
}

export default function contribute(server: PluginServerContext) {
  const ops = new Map<string, Op & { requestId?: string }>();
  const outcomes = new Map<string, Outcome>();
  const display = server.registerSettings(displaySettings);

  async function supportedAgent(paseo: PaseoApi, agentId: string): Promise<{ agent: Agent; file: string } | undefined> {
    const found = await paseo.agents.ref(agentId).refresh().catch(() => undefined);
    const agent = found?.agent;
    if (!agent || agent.archivedAt || !(await isOmp(agent.provider))) return undefined;
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

  async function offerOf(agentId: string, tree: SessionTree): Promise<{ markerId: string; setAside: number; summarized: boolean; from: string; fork: string } | null> {
    const marker = tree.currentMarker();
    if (!marker || (marker.data.op === "goto" && marker.data.kind === "undo") || !marker.data.from || !marker.data.fork) return null;
    if ((await dismissed(agentId)).has(marker.id)) return null;
    const setAside = tree.setAside(marker.data.from, marker.data.fork);
    return setAside > 0
      ? { markerId: marker.id, setAside, summarized: marker.data.op === "summarize", from: marker.data.from, fork: marker.data.fork }
      : null;
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
    if (ops.has(agentId)) throw new Error("A branch switch is still running.");
    if (found.agent.status === "running") throw new Error("The agent is busy. Try again when it has finished.");
    return { ...found, tree: await loadTree(found.file) };
  }

  server.handle(treeChats, async (_input, { paseo }) => {
    const chats: ChatSummary[] = [];
    const listed = await paseo.agents.list();
    for (const { agent } of listed.entries) {
      if (agent.archivedAt || !agent.workspaceId || !(await isOmp(agent.provider))) continue;
      const file = sessionFile(agent);
      if (!file) continue;
      const tree = await loadTree(file).catch(() => undefined);
      if (!tree) continue;
      const offer = await offerOf(agent.id, tree);
      chats.push({
        agentId: agent.id, workspaceId: agent.workspaceId, branches: tree.branches().length,
        offer: offer?.setAside ?? null, phase: ops.get(agent.id)?.phase ?? null,
      });
    }
    const settings = await display.read();
    return { chats, display: settings.status === "ready" ? settings.values : DEFAULT_DISPLAY };
  });

  server.handle(treeState, async ({ agentId }, { paseo }) => {
    const found = await supportedAgent(paseo, agentId);
    if (!found) return UNSUPPORTED;
    const tree = await loadTree(found.file);
    const hosts = await ompHosts(agentId);
    const serving = await servingPids(agentId);
    const offer = await offerOf(agentId, tree);
    const op = ops.get(agentId);
    return {
      supported: true,
      ready: hosts.every(host => serving.has(host.pid)),
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
    const offer = await offerOf(agentId, tree);
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
    const ids = [...(await dismissed(agentId)), marker.id].slice(-50);
    await mkdir(join(linkRoot(), agentId), { recursive: true });
    await writeFile(join(linkRoot(), agentId, "dismissed.json"), JSON.stringify(ids));
    return {};
  });

  server.handle(treeOpenTab, async ({ agentId, entryId, before }, { paseo }) => {
    const found = await supportedAgent(paseo, agentId);
    if (!found) throw new Error("Branches work only in OMP chats.");
    const { agent, file } = found;
    const { lines, entries } = await readEntries(file);
    const tree = new SessionTree(entries);
    const until = before ? tree.byId.get(entryId)?.parentId : entryId;
    if (!until) throw new Error("There is nothing before the first message to open.");
    const copy = await copyBranch(file, lines, tree, until);
    const daemon = await connectLocalDaemon();
    let importedId: string | undefined;
    try {
      const child = await daemon.importAgent({
        providerId: agent.provider, providerHandleId: copy, cwd: agent.cwd,
        ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
        labels: { "paseo.parent-agent-id": agent.id, "session-tree.from-entry": entryId },
      });
      importedId = child.id;
      const title = `${(agent.title?.trim() || "Chat").replace(/ · branch$/, "").slice(0, 60)} · branch`;
      await daemon.updateAgent(child.id, { name: title });
      const thinkingOptionId = agent.thinkingOptionId ?? agent.effectiveThinkingOptionId;
      await daemon.applyAgentConfig(child.id, {
        modelId: agent.model, thinkingOptionId: thinkingOptionId ?? null,
        ...(agent.currentModeId ? { modeId: agent.currentModeId } : {}),
        featureValues: Object.fromEntries((agent.features ?? []).map(feature => [feature.id, feature.value])),
      });
      return { agentId: child.id };
    } catch (error) {
      // Never leave a half-configured tab or an orphan copy behind.
      if (importedId) await daemon.archiveAgent(importedId).catch(() => undefined);
      await removeCopy(copy);
      throw error;
    } finally {
      await daemon.close();
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
