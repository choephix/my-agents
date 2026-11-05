import type { PluginClientContext } from "@getpaseo/plugin/client";
import { z } from "zod";
import { type Entry, type EntryRef, entryKey, inboxClear, inboxList, inboxMarkRead } from "../shared/inbox";

/**
 * A turn's end reaches this client as an agent update; the plugin's hook stores the entry around
 * the same moment, after reading the reply. The list is fetched this long after the update.
 */
const REFETCH_DELAY_MS = 1500;

const agentSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  status: z.string(),
  requiresAttention: z.boolean().nullish(),
  pendingPermissions: z.array(z.unknown()).nullish(),
});

interface AgentFacts {
  title: string | null;
  requiresAttention: boolean;
  /** Status, attention and pending permissions: the facts whose change can mean a new entry. */
  key: string;
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
 * The inbox as this client sees it. Paseo clears an agent's attention flag when someone looks at the
 * agent, so a finished or error entry whose agent no longer wants attention is marked read here.
 * Permission entries are marked read by the daemon when the request is answered.
 */
export function createInbox(client: PluginClientContext): Inbox {
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const agents = new Map<string, AgentFacts>();
  const marking = new Set<string>();
  let entries: readonly Entry[] = [];
  let snapshot: InboxSnapshot = { entries, unread: 0, titles: new Map() };
  let timer: ReturnType<typeof setTimeout> | undefined;

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

  const scheduleRefetch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      refetch().catch((error: unknown) => console.error("[noice-inbox] loading the list failed", error));
    }, REFETCH_DELAY_MS);
  };

  /** Records an agent; true when a fact that can mean a new entry changed. */
  const remember = (raw: unknown): boolean => {
    const parsed = agentSchema.safeParse(raw);
    if (!parsed.success) return false;
    const agent = parsed.data;
    const requiresAttention = agent.requiresAttention === true;
    const key = `${agent.status}|${requiresAttention}|${agent.pendingPermissions?.length ?? 0}`;
    const before = agents.get(agent.id);
    agents.set(agent.id, { title: agent.title ?? null, requiresAttention, key });
    return before?.key !== key || before.title !== (agent.title ?? null);
  };

  client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) return;
      subscription.subscribe({
        snapshot: (page) => {
          agents.clear();
          for (const { agent } of page.entries) remember(agent);
          // The first listing and every reconnect: load the list now, not after the delay.
          clearTimeout(timer);
          refetch().catch((error: unknown) => console.error("[noice-inbox] loading the list failed", error));
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
          scheduleRefetch();
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
      clearTimeout(timer);
      listeners.clear();
    },
  };
}
