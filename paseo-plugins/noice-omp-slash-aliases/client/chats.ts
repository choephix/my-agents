import type { PaseoAgent } from "@getpaseo/client";
import type { PluginClientContext } from "@getpaseo/plugin/client";

/**
 * Open chats (in a workspace, not archived or internal), newest snapshot each, following Paseo's
 * agent list. `onChange` runs after every change; `onNew` for a chat that appears after the first
 * load (so not for a reconnect's snapshot).
 */
export function startChats(client: PluginClientContext, listener: { onChange(): void; onNew(agent: PaseoAgent): void }): { chats: ReadonlyMap<string, PaseoAgent>; stop(): void } {
  const chats = new Map<string, PaseoAgent>();
  const observe = (agent: PaseoAgent) => {
    if (!agent.workspaceId || agent.archivedAt || agent.internal) return void chats.delete(agent.id);
    chats.set(agent.id, agent);
  };
  const lifetime = new AbortController();
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ entries, subscription }) => {
      if (lifetime.signal.aborted) return;
      const replace = (list: readonly { agent: PaseoAgent }[]) => {
        chats.clear();
        for (const { agent } of list) observe(agent);
        listener.onChange();
      };
      replace(entries);
      subscription.subscribe({
        snapshot: snapshot => replace(snapshot.entries),
        update: message => {
          if (message.type !== "agent_update") return;
          if (message.payload.kind === "remove") chats.delete(message.payload.agentId);
          else {
            const isNew = !chats.has(message.payload.agent.id);
            observe(message.payload.agent);
            const agent = chats.get(message.payload.agent.id);
            if (isNew && agent) listener.onNew(agent);
          }
          listener.onChange();
        },
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.warn("[noice-omp-slash-aliases] agent subscription failed", error);
    });
  return { chats, stop: () => lifetime.abort() };
}
