import type { BtwChatSnapshot, BtwEntry } from "../shared/btw";

/** How the store reaches the plugin's daemon side (plugin subscription + RPCs in production). */
export interface BtwTransport {
  watch(onSnapshot: (chats: readonly BtwChatSnapshot[]) => void): () => void;
  list(agentId: string): Promise<BtwEntry[]>;
  ask(agentId: string, question: string): Promise<void>;
  dismiss(agentId: string, id: string): Promise<void>;
}

/**
 * A question this client sent whose answer record has not appeared yet. It
 * matches the first new record (one not in `knownIds`) with the same question.
 */
export interface PendingAsk {
  key: string;
  question: string;
  /** Record ids that existed before sending; null until the send completed. */
  knownIds: ReadonlySet<string> | null;
  sentAt: number;
  error?: string;
}

export interface ChatState {
  workspaceId: string;
  entries: readonly BtwEntry[];
  pending: readonly PendingAsk[];
}

export interface BtwSnapshot {
  chats: ReadonlyMap<string, ChatState>;
  /** The chat whose answer sheet is open on this client. */
  openAgentId: string | null;
}

/** A sent question whose record has not appeared after this long is reported as failed. */
export const ASK_TIMEOUT_MS = 30_000;

/**
 * Settles pending asks against a chat's current records. Each new record
 * settles at most one ask, oldest ask first; asks past the timeout fail.
 */
export function settlePending(pending: readonly PendingAsk[], entries: readonly BtwEntry[], now: number): PendingAsk[] {
  const claimed = new Set<string>();
  const remaining: PendingAsk[] = [];
  for (const ask of [...pending].sort((a, b) => a.sentAt - b.sentAt)) {
    if (ask.error || !ask.knownIds) {
      remaining.push(ask);
      continue;
    }
    const match = [...entries]
      .reverse()
      .find(entry => !ask.knownIds!.has(entry.id) && !claimed.has(entry.id) && entry.question === ask.question);
    if (match) {
      claimed.add(match.id);
      continue;
    }
    remaining.push(
      now - ask.sentAt > ASK_TIMEOUT_MS
        ? { ...ask, error: "OMP did not start the answer. Reload or restart the agent, then ask again." }
        : ask,
    );
  }
  return remaining.sort((a, b) => b.sentAt - a.sentAt);
}

export function isBusy(chat: ChatState): boolean {
  return chat.pending.some(ask => !ask.error) || chat.entries.some(entry => entry.status === "running");
}

/** `0:07`, `1:23`. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** `6s`, `1m 12s`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export class BtwStore {
  readonly #transport: BtwTransport;
  readonly #now: () => number;
  #chats = new Map<string, ChatState>();
  #openAgentId: string | null = null;
  #snapshot: BtwSnapshot = { chats: new Map(), openAgentId: null };
  readonly #listeners = new Set<() => void>();
  readonly #hosts = new Map<string, symbol[]>();
  #unwatch: (() => void) | undefined;
  #timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;
  #nextKey = 0;

  constructor(transport: BtwTransport, now: () => number = Date.now) {
    this.#transport = transport;
    this.#now = now;
    this.#unwatch = this.#transport.watch(chats => this.#apply(chats));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): BtwSnapshot => this.#snapshot;

  dispose(): void {
    this.#disposed = true;
    this.#unwatch?.();
    this.#unwatch = undefined;
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = undefined;
    }
    this.#listeners.clear();
  }

  async ask(agentId: string, workspaceId: string, question: string): Promise<void> {
    const ask: PendingAsk = { key: `ask-${this.#nextKey++}`, question, knownIds: null, sentAt: this.#now() };
    this.#update(agentId, chat => ({ ...(chat ?? emptyChat(workspaceId)), pending: [ask, ...(chat?.pending ?? [])] }));
    this.open(agentId);
    let patch: Partial<PendingAsk>;
    try {
      const before = await this.#transport.list(agentId);
      await this.#transport.ask(agentId, question);
      patch = { knownIds: new Set(before.map(entry => entry.id)), sentAt: this.#now() };
    } catch (error) {
      patch = { error: error instanceof Error ? error.message : String(error) };
    }
    if (this.#disposed) return;
    this.#update(agentId, chat => {
      if (!chat) return chat;
      const pending = chat.pending.map(p => (p.key === ask.key ? { ...p, ...patch } : p));
      // A push with the new record may have arrived while `ask` was awaiting its RPC response.
      return { ...chat, pending: settlePending(pending, chat.entries, this.#now()) };
    });
    this.#schedulePendingTimeout();
  }

  open(agentId: string): void {
    this.#openAgentId = agentId;
    this.#emit();
  }

  close(): void {
    this.#openAgentId = null;
    this.#emit();
  }

  /** Dismisses an answer on every client, or a local failed ask. */
  async dismiss(agentId: string, id: string): Promise<void> {
    const chat = this.#chats.get(agentId);
    if (!chat) return;
    if (chat.pending.some(ask => ask.key === id)) {
      this.#update(agentId, current => {
        if (!current) return current;
        const pending = current.pending.filter(ask => ask.key !== id);
        return current.entries.length || pending.length ? { ...current, pending } : undefined;
      });
      this.#closeIfEmpty(agentId);
      this.#schedulePendingTimeout();
      return;
    }
    this.#update(agentId, current => {
      if (!current) return current;
      const entries = current.entries.filter(entry => entry.id !== id);
      return entries.length || current.pending.length ? { ...current, entries } : undefined;
    });
    this.#closeIfEmpty(agentId);
    await this.#transport.dismiss(agentId, id);
  }

  /** Several composers can show one chat (split panes); only the first mounted one hosts its sheet. */
  claimHost(agentId: string, token: symbol): () => void {
    this.#hosts.set(agentId, [...(this.#hosts.get(agentId) ?? []), token]);
    this.#emit();
    return () => {
      const rest = (this.#hosts.get(agentId) ?? []).filter(t => t !== token);
      if (rest.length) this.#hosts.set(agentId, rest);
      else this.#hosts.delete(agentId);
      this.#emit();
    };
  }

  isHost(agentId: string, token: symbol): boolean {
    return this.#hosts.get(agentId)?.[0] === token;
  }

  #apply(snapshots: readonly BtwChatSnapshot[]): void {
    if (this.#disposed) return;
    const byAgent = new Map(snapshots.map(chat => [chat.agentId, chat]));
    const now = this.#now();
    const next = new Map<string, ChatState>();
    for (const agentId of new Set([...byAgent.keys(), ...this.#chats.keys()])) {
      const incoming = byAgent.get(agentId);
      const existing = this.#chats.get(agentId);
      const workspaceId = incoming?.workspaceId ?? existing!.workspaceId;
      // Absent from the server snapshot: every answer was dismissed.
      const entries = incoming ? incoming.entries : [];
      const pending = settlePending(existing?.pending ?? [], entries, now);
      if (!incoming && !pending.length) continue;
      next.set(agentId, { workspaceId, entries, pending });
    }
    this.#chats = next;
    if (this.#openAgentId && !next.has(this.#openAgentId)) this.#openAgentId = null;
    this.#schedulePendingTimeout();
    this.#emit();
  }

  #schedulePendingTimeout(): void {
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = undefined;
    }
    if (this.#disposed) return;
    let nextAt = Infinity;
    for (const chat of this.#chats.values()) {
      for (const ask of chat.pending) {
        if (!ask.error && ask.knownIds) nextAt = Math.min(nextAt, ask.sentAt + ASK_TIMEOUT_MS + 1);
      }
    }
    if (!Number.isFinite(nextAt)) return;
    this.#timeoutTimer = setTimeout(() => {
      this.#timeoutTimer = undefined;
      if (this.#disposed) return;
      const now = this.#now();
      let changed = false;
      for (const [agentId, chat] of this.#chats) {
        if (!chat.pending.length) continue;
        const pending = settlePending(chat.pending, chat.entries, now);
        if (pending.length !== chat.pending.length || pending.some((p, i) => p !== chat.pending[i])) {
          this.#chats.set(agentId, { ...chat, pending });
          changed = true;
        }
      }
      this.#schedulePendingTimeout();
      if (changed) this.#emit();
    }, Math.max(0, nextAt - this.#now()));
  }

  #closeIfEmpty(agentId: string): void {
    if (this.#openAgentId === agentId && !this.#chats.has(agentId)) {
      this.#openAgentId = null;
      this.#emit();
    }
  }

  #update(agentId: string, change: (chat: ChatState | undefined) => ChatState | undefined): void {
    const next = change(this.#chats.get(agentId));
    if (next) this.#chats.set(agentId, next);
    else this.#chats.delete(agentId);
    this.#emit();
  }

  #emit(): void {
    this.#snapshot = { chats: new Map(this.#chats), openAgentId: this.#openAgentId };
    for (const listener of this.#listeners) listener();
  }
}

function emptyChat(workspaceId: string): ChatState {
  return { workspaceId, entries: [], pending: [] };
}
