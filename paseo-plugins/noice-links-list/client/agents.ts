import type { PluginClientContext } from "@getpaseo/plugin/client";

export interface AgentSummary {
  id: string;
  workspaceId?: string | null;
  status: string;
  title?: string | null;
  archivedAt?: string | null;
  internal?: boolean;
}

export interface AgentListener {
  /** The full list, first and after every resubscription. */
  replace(agents: readonly AgentSummary[]): void;
  update(agent: AgentSummary): void;
  remove(agentId: string): void;
}

/** One `agents.list` subscription for the composer pills and the header buttons. */
export function followAgents(client: PluginClientContext, listeners: readonly AgentListener[]): () => void {
  const lifetime = new AbortController();
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ entries, subscription }) => {
      if (lifetime.signal.aborted) return;
      const replace = (list: readonly { agent: AgentSummary }[]) => {
        const agents = list.map(({ agent }) => agent);
        for (const listener of listeners) listener.replace(agents);
      };
      replace(entries);
      subscription.subscribe({
        snapshot: (snapshot) => replace(snapshot.entries),
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          for (const listener of listeners) {
            if (update.kind === "remove") listener.remove(update.agentId);
            else listener.update(update.agent);
          }
        },
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.warn("[noice-links-list] agent subscription failed", error);
    });
  return () => lifetime.abort();
}
