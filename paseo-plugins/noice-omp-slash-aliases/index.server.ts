import type { PluginServerContext } from "@getpaseo/plugin/server";
import { btwAsk, btwChats, btwDismiss, btwList } from "./shared/btw";
import { ompProviders } from "./shared/providers";
import { tanStatus } from "./shared/tan";
import { btwRoot, dismissEntry, listEntries, markedPids, pruneOutbox, summarizeChats } from "./server/btw-outbox";
import { btwReady, isAlive, isOmpRpcHost, listProcesses, type ProcessInfo, processStartedAt } from "./server/omp-processes";
import { readOmpProviders } from "./server/providers";
import { deriveState, nearestTangent, TanSessions } from "./server/tan-sessions";

const PRUNE_EVERY_MS = 60 * 60_000;
/** Running rows poll about once a second; one /proc scan serves all of them. */
const PROCESS_CACHE_MS = 3_000;
/** A tangent's process started before it; allow for clock rounding. */
const START_SLACK_MS = 2_000;

export default function contribute(server: PluginServerContext) {
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
  return () => clearInterval(timer);
}
