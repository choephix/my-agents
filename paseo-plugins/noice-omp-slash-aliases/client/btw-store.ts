import type { BtwChat, BtwEntry } from "../shared/btw";

/** How the store reaches the plugin's daemon side (the plugin RPCs in production). */
export interface BtwTransport {
  chats(): Promise<BtwChat[]>;
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
  /** Server summary: newest updatedAt, so unchanged chats are not refetched. */
  updatedAt: number;
}

export interface BtwSnapshot {
  chats: ReadonlyMap<string, ChatState>;
  /** The chat whose answer sheet is open on this client. */
  openAgentId: string | null;
}

/** A sent question whose record has not appeared after this long is reported as failed. */
export const ASK_TIMEOUT_MS = 30_000;
const FAST_POLL_MS = 600;
const SLOW_POLL_MS = 4_000;

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
  /** Bumped by each poll and schedule; a scheduled poll only runs if still current. */
  #ticket = 0;
  #polling: Promise<void> | undefined;
  #pollAgain = false;
  #disposed = false;
  #nextKey = 0;

  constructor(transport: BtwTransport, now: () => number = Date.now) {
    this.#transport = transport;
    this.#now = now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): BtwSnapshot => this.#snapshot;

  dispose(): void {
    this.#disposed = true;
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
    this.#update(agentId, chat => chat && { ...chat, pending: chat.pending.map(p => (p.key === ask.key ? { ...p, ...patch } : p)) });
    void this.refresh();
  }

  open(agentId: string): void {
    this.#openAgentId = agentId;
    this.#emit();
    void this.refresh();
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
      this.#update(agentId, current => current && { ...current, pending: current.pending.filter(ask => ask.key !== id) });
      return;
    }
    this.#update(agentId, current => current && { ...current, entries: current.entries.filter(entry => entry.id !== id) });
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

  /**
   * Polls now: chat summaries, then the records of chats someone is waiting on.
   * Calls during a poll share it and add one more round, so there is one loop
   * and the returned promise covers the state at the time of the call.
   */
  refresh(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#pollAgain = true;
    this.#polling ??= (async () => {
      this.#ticket++;
      while (this.#pollAgain) {
        this.#pollAgain = false;
        try {
          await this.#poll();
        } catch {
          // Host offline or plugin reloading: keep what is shown and try again.
        }
      }
      this.#polling = undefined;
      this.#schedule();
    })();
    return this.#polling;
  }

  async #poll(): Promise<void> {
    const summaries = new Map((await this.#transport.chats()).map(chat => [chat.agentId, chat]));
    const toFetch = [...summaries.values()]
      .filter(summary => {
        const chat = this.#chats.get(summary.agentId);
        const watched = summary.agentId === this.#openAgentId || summary.running || !!chat?.pending.length;
        return watched || chat?.updatedAt !== summary.updatedAt;
      })
      .map(summary => summary.agentId);
    const lists = new Map(
      await Promise.all(toFetch.map(async agentId => [agentId, await this.#transport.list(agentId)] as const)),
    );
    // Build from the current state, not the one before the awaits: asks may have changed meanwhile.
    const now = this.#now();
    const next = new Map<string, ChatState>();
    for (const agentId of new Set([...summaries.keys(), ...this.#chats.keys()])) {
      const summary = summaries.get(agentId);
      const chat = this.#chats.get(agentId) ?? emptyChat(summary!.workspaceId);
      // Not in the summary: every answer was dismissed.
      const entries = summary ? (lists.get(agentId) ?? chat.entries) : [];
      const pending = settlePending(chat.pending, entries, now);
      if (!summary && !pending.length) continue;
      next.set(agentId, { ...chat, entries, pending, updatedAt: summary?.updatedAt ?? -1 });
    }
    this.#chats = next;
    if (this.#openAgentId && !next.has(this.#openAgentId)) this.#openAgentId = null;
    this.#emit();
  }

  #schedule(): void {
    if (this.#disposed) return;
    const fast = this.#openAgentId !== null || [...this.#chats.values()].some(isBusy);
    const ticket = ++this.#ticket;
    setTimeout(() => ticket === this.#ticket && void this.refresh(), fast ? FAST_POLL_MS : SLOW_POLL_MS);
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
  return { workspaceId, entries: [], pending: [], updatedAt: -1 };
}
