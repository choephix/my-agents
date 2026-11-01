import { resolve } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { btwAsk, btwChats, btwDismiss, btwList } from "./shared/btw";
import { nextChatArmed, nextChatGet, nextChatSet } from "./shared/next-chat";
import { preferences } from "./shared/preferences";
import { ompProviders } from "./shared/providers";
import { tanStatus } from "./shared/tan";
import { btwRoot, dismissEntry, listEntries, markedPids, pruneOutbox, summarizeChats } from "./server/btw-outbox";
import { type Armed, nextChatFile, NextChatStore } from "./server/next-chat";
import { btwReady, isAlive, isOmpRpcHost, listProcesses, type ProcessInfo, processStartedAt } from "./server/omp-processes";
import { readBaseProvider, readOmpProviders } from "./server/providers";
import { deriveState, nearestTangent, TanSessions } from "./server/tan-sessions";

const PRUNE_EVERY_MS = 60 * 60_000;
/** Running rows poll about once a second; one /proc scan serves all of them. */
const PROCESS_CACHE_MS = 3_000;
/** A tangent's process started before it; allow for clock rounding. */
const START_SLACK_MS = 2_000;
/** Built-in providers whose agents get Paseo's per-agent `systemPrompt` (Paseo 0.14 source). */
const SYSTEM_PROMPT_PROVIDERS: Record<string, true> = { omp: true, claude: true, codex: true, opencode: true, pi: true };
/** A created chat that never shows up (its provider failed to start) hands its text back after this. */
const CREATE_TIMEOUT_MS = 2 * 60_000;

export default function contribute(server: PluginServerContext) {
  server.registerSettings(preferences);
  const root = btwRoot();
  // Chats keep their workspace; only found ones are cached, so a missing agent is retried.
  const workspaceIds = new Map<string, string>();

  server.handle(btwChats, async (_input, { paseo }) => {
    const chats = [];
    for (const summary of await summarizeChats(root)) {
      let workspaceId = workspaceIds.get(summary.agentId);
      if (!workspaceId) {
        const found = await paseo.agents.ref(summary.agentId).refresh().catch(() => undefined);
        if (!found || found.agent.archivedAt || !found.agent.workspaceId) continue;
        workspaceId = found.agent.workspaceId;
        workspaceIds.set(summary.agentId, workspaceId);
      }
      chats.push({ ...summary, workspaceId });
    }
    return { chats };
  });

  server.handle(btwList, async ({ agentId }) => ({ entries: await listEntries(root, agentId) }));

  server.handle(ompProviders, async () => ({ providers: await readOmpProviders() }));

  server.handle(btwAsk, async ({ agentId, question }, { paseo }) => {
    const found = await paseo.agents.ref(agentId).refresh();
    if (!found || found.agent.archivedAt) throw new Error("This chat is no longer available.");
    if (!(await readOmpProviders()).includes(found.agent.provider)) throw new Error("/btw works only in OMP chats.");
    if (!btwReady(await listProcesses(), agentId, await markedPids(root, agentId))) {
      throw new Error("This OMP agent started before /btw was installed. Reload or restart the agent, then ask again.");
    }
    // /follow-up is Paseo's out-of-band path: it never cancels a running reply.
    await paseo.agents.ref(agentId).send(`/follow-up /btw ${question}`);
    return {};
  });

  server.handle(btwDismiss, async ({ agentId, id }) => {
    await dismissEntry(root, agentId, id);
    return {};
  });

  // Instructions for a workspace's next chat: armed from the header button, put into the new
  // chat's own system prompt (Paseo's `systemPrompt`, saved with the agent and given on every resume).
  const nextChat = new NextChatStore(nextChatFile());
  server.handle(nextChatArmed, async () => ({ armed: await nextChat.armed() }));
  server.handle(nextChatGet, async ({ workspaceId }, { paseo }) => {
    const { armed, lastUsed } = await nextChat.get(workspaceId);
    const title = lastUsed ? ((await paseo.agents.ref(lastUsed.agentId).refresh().catch(() => undefined))?.agent.title ?? null) : null;
    return { armed: armed && { text: armed.text, expiresAt: armed.expiresAt }, lastUsed: lastUsed && { ...lastUsed, title } };
  });
  server.handle(nextChatSet, async ({ workspaceId, text }, { paseo }) => {
    const cwd = text.trim() ? (await paseo.workspaces.ref(workspaceId).refresh())?.workspaceDirectory : "";
    if (cwd === undefined) throw new Error("This workspace has no directory.");
    return { expiresAt: await nextChat.set(workspaceId, cwd, text) };
  });
  /** Taken texts until their chat's `agent.created` arrives, by directory and provider. */
  const taken = new Map<string, { workspaceId: string; armed: Armed; timer: ReturnType<typeof setTimeout> }>();
  const giveBack = (key: string, why: string) => {
    const entry = taken.get(key);
    if (!entry) return;
    taken.delete(key);
    clearTimeout(entry.timer);
    console.warn(`[noice-omp-slash-aliases] next-chat instructions re-armed: ${why}`);
    void nextChat.restore(entry.workspaceId, entry.armed);
  };
  // Paseo shows this hook only the session config. Chats Stefan starts from the app carry no
  // title there; agents made by agents (MCP create_agent requires one), the side-agent plugin,
  // schedules and `paseo run --title` do. `agent.created` then checks the parent label too.
  const offCreate = server.before("agent.create", async ({ request }) => {
    const { config } = request;
    if (config.title?.trim()) return;
    try {
      if (!SYSTEM_PROMPT_PROVIDERS[await readBaseProvider(config.provider)]) return;
      const found = await nextChat.take(config.cwd);
      if (!found) return;
      const key = `${found.armed.cwd}\n${config.provider}`;
      clearTimeout(taken.get(key)?.timer);
      taken.set(key, { ...found, timer: setTimeout(() => giveBack(key, "the chat was never created"), CREATE_TIMEOUT_MS) });
      const systemPrompt = config.systemPrompt?.trim() ? `${config.systemPrompt}\n\n${found.armed.text}` : found.armed.text;
      return { ...request, config: { ...config, systemPrompt } };
    } catch (error) {
      console.error("[noice-omp-slash-aliases] next-chat instructions failed", error);
    }
  });
  const offCreated = server.on("agent.created", async ({ agent }) => {
    const key = `${resolve(agent.cwd)}\n${agent.provider}`;
    const entry = taken.get(key);
    if (!entry) return;
    if (agent.parentAgentId || agent.title) return giveBack(key, `agent ${agent.id} was not started by hand`);
    taken.delete(key);
    clearTimeout(entry.timer);
    await nextChat.used(entry.workspaceId, agent.id, entry.armed.text);
  });
  const offArchived = server.on("workspace.archived", ({ workspace }) => nextChat.forget(workspace.id));

  const sessions = new TanSessions();
  let processes: { at: number; list: Promise<ProcessInfo[]> } | undefined;
  async function currentProcesses(): Promise<ProcessInfo[]> {
    if (!processes || Date.now() - processes.at > PROCESS_CACHE_MS) processes = { at: Date.now(), list: listProcesses() };
    return processes.list;
  }
  /** Whether an OMP process that could be running a tangent started at `startedAt` is still up for this chat. */
  async function hostAlive(agentId: string, startedAt: number): Promise<boolean> {
    for (const info of (await currentProcesses()).filter(info => isOmpRpcHost(info, agentId))) {
      const hostStart = await processStartedAt(info.pid);
      if (hostStart !== undefined && hostStart <= startedAt + START_SLACK_MS) return true;
    }
    return false;
  }

  server.handle(tanStatus, async ({ agentId, tanId, at }) => {
    const parent = await sessions.parentFile(agentId);
    if (!parent) return { state: null };
    const id = tanId ?? nearestTangent(await sessions.tangentStarts(parent), at);
    if (!id) return { state: null };
    const transcript = await sessions.transcript(parent, id);
    const delivered = (await sessions.deliveries(parent)).flatMap(delivery => delivery.jobs).find(job => job.agentId === id);
    const settled = delivered || (transcript?.final && transcript.exitedAt !== undefined);
    const alive = settled || !transcript ? true : await hostAlive(agentId, transcript.startedAt);
    return { state: deriveState(id, transcript, delivered, alive) };
  });

  const prune = () => void pruneOutbox(root, isAlive).catch(error => console.error("/btw outbox prune failed", error));
  prune();
  const timer = setInterval(prune, PRUNE_EVERY_MS);
  return () => {
    clearInterval(timer);
    offCreate();
    offCreated();
    offArchived();
    taken.forEach(entry => clearTimeout(entry.timer));
  };
}
