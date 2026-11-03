import type { PaseoAgent } from "@getpaseo/client";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useSyncExternalStore } from "react";
import { COUNTS_LABEL, EMOJI_LABEL, HUB_LABEL, restoreHub, ROLE_LABEL } from "../shared/contracts";

/** A bot, as its hub agent tells it: the sidebar and the header buttons need nothing else. */
export interface Hub {
  agentId: string;
  workspaceId: string;
  botId: string;
  name: string;
  emoji: string;
  running: number;
  unread: number;
  createdAt: string;
  /** Its tab was closed (Paseo archives the agent then): the tile restores it before opening. */
  archived: boolean;
}

function hubOf(agent: PaseoAgent): Hub | null {
  const botId = agent.labels[HUB_LABEL];
  if (agent.labels[ROLE_LABEL] !== "hub" || !botId || !agent.workspaceId) return null;
  const [running, unread] = (agent.labels[COUNTS_LABEL] ?? "0,0").split(",").map(Number);
  return {
    agentId: agent.id, workspaceId: agent.workspaceId, botId, name: agent.title ?? "Bot", emoji: agent.labels[EMOJI_LABEL] ?? "🤖",
    running: running || 0, unread: unread || 0, createdAt: agent.createdAt, archived: !!agent.archivedAt,
  };
}

export interface Hubs {
  subscribe(listener: () => void): () => void;
  current(): Hub[];
  /** The hubs, re-rendering on change. */
  use(): Hub[];
  /** Whether the first list has come; before it, `current()` is empty for want of it. */
  loaded(): boolean;
  /** Before opening a hub: brings back one whose tab was closed. */
  restore(hub: Hub): Promise<void>;
  stop(): void;
}

/** Hub agents of the client's host, kept current by one owned list subscription (no polling). */
export function watchHubs(client: PluginClientContext): Hubs {
  let hubs: Hub[] = [];
  let loaded = false;
  const byId = new Map<string, Hub>();
  const listeners = new Set<() => void>();
  const publish = () => {
    hubs = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const listener of listeners) listener();
  };
  const put = (agent: PaseoAgent) => {
    const hub = hubOf(agent);
    if (hub) byId.set(agent.id, hub);
    else byId.delete(agent.id);
  };
  const lifetime = new AbortController();
  void client.paseo.agents
    .list({ filter: { labels: { [ROLE_LABEL]: "hub" }, includeBackground: true, includeArchived: true }, subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          byId.clear();
          for (const { agent } of entries) put(agent);
          loaded = true;
          publish();
        },
        update: message => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") put(update.agent);
          else byId.delete(update.agentId);
          publish();
        },
      });
    })
    .catch(error => {
      if (lifetime.signal.aborted) return;
      console.error("noice-bots: watching bots failed", error);
      loaded = true;
      publish();
    });
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  return {
    subscribe,
    current: () => hubs,
    use: () => useSyncExternalStore(subscribe, () => hubs),
    loaded: () => loaded,
    restore: async hub => { if (hub.archived) await client.rpc(restoreHub, { botId: hub.botId }); },
    stop: () => lifetime.abort(),
  };
}
