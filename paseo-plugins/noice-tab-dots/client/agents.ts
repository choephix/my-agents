import type { PluginClientContext } from "@getpaseo/plugin/client";
import { type AgentInfo, readAgent } from "./model";

type Agents = PluginClientContext["paseo"]["agents"];

/** The daemon's largest page (`fetch_agents_request.page.limit` max). */
const PAGE_LIMIT = 200;

interface AgentPage {
  entries: readonly { agent: unknown }[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

/**
 * Live map of every non-archived agent on this host. Calls `onChange` with the whole map after
 * each snapshot (the first listing and every reconnect), after each further page a snapshot
 * points to (the daemon pages at 200, newest first), and after each update.
 * Returns a cleanup that ends the subscription.
 */
export function watchAgents(
  source: Agents,
  onChange: (agents: ReadonlyMap<string, AgentInfo>) => void,
): () => void {
  const lifetime = new AbortController();
  const agents = new Map<string, AgentInfo>();
  // Each snapshot starts a generation; pages of an older one are dropped.
  let generation = 0;
  // Agents an update touched since this generation began: newer than any page still loading.
  let touched = new Set<string>();

  const loadRest = async (cursor: string, ofGeneration: number) => {
    let next: string | null = cursor;
    while (next && !lifetime.signal.aborted && ofGeneration === generation) {
      const page: AgentPage = await source.list({ page: { limit: PAGE_LIMIT, cursor: next } });
      if (lifetime.signal.aborted || ofGeneration !== generation) return;
      for (const { agent } of page.entries) {
        const info = readAgent(agent);
        if (info && !touched.has(info.id) && !agents.has(info.id)) agents.set(info.id, info);
      }
      onChange(agents);
      next = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
    }
  };

  const replaceAll = (page: AgentPage) => {
    generation += 1;
    touched = new Set();
    agents.clear();
    for (const { agent } of page.entries) {
      const info = readAgent(agent);
      if (info) agents.set(info.id, info);
    }
    onChange(agents);
    const cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
    if (cursor) {
      loadRest(cursor, generation).catch((error: unknown) => {
        if (!lifetime.signal.aborted) console.error("[noice-tab-dots] loading more agents failed", error);
      });
    }
  };

  source
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) return;
      // Delivers the current snapshot at once, then buffered and live updates.
      subscription.subscribe({
        snapshot: replaceAll,
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          const id = update.kind === "remove" ? update.agentId : update.agent.id;
          touched.add(id);
          const info = update.kind === "remove" ? null : readAgent(update.agent);
          if (info) agents.set(id, info);
          else agents.delete(id);
          onChange(agents);
        },
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("[noice-tab-dots] agent subscription failed", error);
    });
  return () => lifetime.abort();
}
