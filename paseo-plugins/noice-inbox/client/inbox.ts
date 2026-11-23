import type { PluginClientContext } from "@getpaseo/plugin/client";
import { z } from "zod";
import { type Entry, type EntryRef, entryKey, inboxClear, inboxList, inboxMarkRead, inboxWatch } from "../shared/inbox";

const agentSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  requiresAttention: z.boolean().nullish(),
});

interface AgentFacts {
  title: string | null;
  requiresAttention: boolean;
}

export interface InboxSnapshot {
  entries: readonly Entry[];
  unread: number;
  /** Live agent titles, for agents among the newest 200. */
  titles: ReadonlyMap<string, string>;
}

export interface Inbox {
  subscribe(listener: () => void): () => void;
  getSnapshot(): InboxSnapshot;
  refetch(): Promise<void>;
  markRead(refs: readonly EntryRef[]): Promise<void>;
  /** Removes the given entries, or all of them. */
  clear(refs?: readonly EntryRef[]): Promise<void>;
  dispose(): void;
}

/**
 * The inbox as this client sees it. Entries are pushed live from the daemon via `inboxWatch`.
 * Paseo clears an agent's attention flag when someone looks at the agent, so a finished or error
 * entry whose agent no longer wants attention is marked read here. Permission entries are marked
 * read by the daemon when the request is answered.
 */
export function createInbox(client: PluginClientContext): Inbox {
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const agents = new Map<string, AgentFacts>();
  const marking = new Set<string>();
  let entries: readonly Entry[] = [];
  let snapshot: InboxSnapshot = { entries, unread: 0, titles: new Map() };

  const publish = () => {
    const titles = new Map<string, string>();
    for (const entry of entries) {
      const title = agents.get(entry.agentId)?.title;
      if (title) titles.set(entry.agentId, title);
    }
    snapshot = { entries, unread: entries.filter((entry) => !entry.read).length, titles };
    for (const listener of listeners) listener();
  };

  const markSeen = () => {
    const seen = entries.filter(
      (entry) =>
        !entry.read &&
        entry.kind !== "permission" &&
        !marking.has(entryKey(entry)) &&
        agents.get(entry.agentId)?.requiresAttention === false,
    );
    if (seen.length > 0) void markRead(seen);
  };

  const accept = ({ entries: next }: { entries: Entry[] }) => {
    if (lifetime.signal.aborted) return;
    entries = next;
    publish();
    markSeen();
  };

  const refetch = () => client.rpc(inboxList, {}).then(accept);

  const markRead = async (refs: readonly EntryRef[]) => {
    const keys = refs.map(entryKey);
    for (const key of keys) marking.add(key);
    try {
      accept(await client.rpc(inboxMarkRead, { items: refs.map(({ agentId, kind }) => ({ agentId, kind })) }));
    } catch (error) {
      console.error("[noice-inbox] marking read failed", error);
    } finally {
      for (const key of keys) marking.delete(key);
    }
  };

  /** Records an agent; true when its title or attention flag changed. */
  const remember = (raw: unknown): boolean => {
    const parsed = agentSchema.safeParse(raw);
    if (!parsed.success) return false;
    const agent = parsed.data;
    const requiresAttention = agent.requiresAttention === true;
    const title = agent.title ?? null;
    const before = agents.get(agent.id);
    agents.set(agent.id, { title, requiresAttention });
    return before?.title !== title || before.requiresAttention !== requiresAttention;
  };

  // Push subscription from the daemon: delivers the list right away, on every change, and on reconnect.
  const watch = client.subscribe(inboxWatch, {}, accept, {
    signal: lifetime.signal,
    onClosed: ({ error }) => {
      if (error && !lifetime.signal.aborted) console.error("[noice-inbox] inbox subscription closed", error);
    },
  });

  // Bot threads and the agents they start live in background workspaces, which Paseo lists only on request.
  client.paseo.agents
    .list({ subscribe: {}, filter: { includeBackground: true }, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) return;
      subscription.subscribe({
        snapshot: (page) => {
          agents.clear();
          for (const { agent } of page.entries) remember(agent);
          publish();
          markSeen();
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") {
            agents.delete(update.agentId);
            return;
          }
          if (!remember(update.agent)) return;
          const isEntry = entries.some((entry) => entry.agentId === update.agent.id);
          if (isEntry) publish();
          markSeen();
        },
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("[noice-inbox] agent subscription failed", error);
    });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    refetch,
    markRead,
    async clear(refs?: readonly EntryRef[]) {
      accept(await client.rpc(inboxClear, refs ? { items: refs.map(({ agentId, kind }) => ({ agentId, kind })) } : {}));
    },
    dispose() {
      lifetime.abort();
      watch();
      listeners.clear();
    },
  };
}
