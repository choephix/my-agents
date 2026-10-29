import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { KeptAwakeReason, ProviderSleep } from "../shared/rpc";

type Paseo = PluginHandlerContext["paseo"];

// The custom fork's additions to the daemon's PaseoApi. The official 0.12 client types don't
// have them, and official daemons don't either, so every use goes through `sleepApi`.
interface SleepMarker { sleptAt: string; reason: "idle" | "manual"; rssBytes: number | null }
interface SleepState {
  providers: ProviderSleep[];
  asleep: { agentId: string; provider: string; sleep: SleepMarker | null }[];
  keptAwake: { agentId: string; reason: KeptAwakeReason; since: string }[];
}
interface SleepAgents { sleepState(): Promise<SleepState> }
interface SleepHandle { wake(): Promise<{ status: string }>; sleep(): Promise<SleepMarker | null> }

/** The fork's sleep API on this daemon, or null on a daemon that can't sleep agents. */
export function sleepApi(paseo: Paseo): SleepAgents | null {
  const agents = paseo.agents as unknown as Partial<SleepAgents>;
  return typeof agents.sleepState === "function" ? (agents as SleepAgents) : null;
}

export async function wakeAgent(paseo: Paseo, agentId: string): Promise<{ status: string }> {
  const handle = paseo.agents.ref(agentId) as unknown as Partial<SleepHandle>;
  if (typeof handle.wake !== "function") throw new Error("This Paseo server can't sleep agents.");
  const agent = await handle.wake();
  return { status: agent.status };
}

const REFUSALS: Record<string, string> = {
  running: "Can't sleep: it's working right now.",
  permission: "Can't sleep: it's waiting for your permission.",
  background_work: "Can't sleep: a background job is still running.",
};

/**
 * Puts a chat to sleep now. The fork's manual sleep ignores "open in a client", so a focused chat
 * sleeps too. Returns null on success, or a plain sentence saying why it can't sleep.
 */
export async function sleepAgentNow(paseo: Paseo, agentId: string): Promise<string | null> {
  const handle = paseo.agents.ref(agentId) as unknown as Partial<SleepHandle>;
  if (typeof handle.sleep !== "function") return "This Paseo server can't sleep agents.";
  try {
    await handle.sleep();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = /cannot sleep now: (\w+)/.exec(message)?.[1];
    if (reason) return REFUSALS[reason] ?? `Can't sleep: ${reason.replace(/_/g, " ")}.`;
    if (/cannot sleep: reading their conversation/.test(message)) return "Only OMP chats can sleep.";
    throw error;
  }
}

const PAGE_LIMIT = 200; // the daemon's largest page
const MAX_PAGES = 20;

/**
 * Title and workspace of the agents in `ids`, read from the agent directory (storage only, it
 * never starts an agent). Pages until every id is found; `statuses` narrows the listing.
 */
export async function describeAgents(
  paseo: Paseo,
  ids: ReadonlySet<string>,
  statuses?: ("closed" | "initializing" | "idle" | "running" | "error")[],
): Promise<Map<string, { title: string; workspaceId: string | null }>> {
  const found = new Map<string, { title: string; workspaceId: string | null }>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES && found.size < ids.size; page += 1) {
    const result = await paseo.agents.list({
      filter: { includeBackground: true, ...(statuses ? { statuses } : {}) },
      page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
    });
    for (const { agent } of result.entries) {
      if (ids.has(agent.id)) {
        found.set(agent.id, { title: agent.title?.trim() || "Untitled chat", workspaceId: agent.workspaceId ?? null });
      }
    }
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
    cursor = result.pageInfo.nextCursor;
  }
  return found;
}
