import type { ChatSummary, OpKind, Outcome, TreeState } from "../shared/tree";
import type { TreeDisplay } from "../shared/settings";

/** How the store reaches the plugin's daemon side (the plugin RPCs in production). */
export interface TreeTransport {
  /** The OMP chats and the plugin's display settings (read with them, so a saved change lands on the next poll). */
  chats(): Promise<{ chats: ChatSummary[]; display: TreeDisplay }>;
  state(agentId: string): Promise<TreeState>;
  /** Both return the server's op id. `summarize`: summarize what the move leaves, at the branch point. */
  goto(agentId: string, kind: "continue" | "reask" | "switch" | "undo", target: string | undefined, summarize: boolean): Promise<string>;
  summarize(agentId: string, focus: string): Promise<string>;
  cancel(agentId: string): Promise<void>;
  dismiss(agentId: string): Promise<void>;
  openTab(agentId: string, entryId: string, before: boolean): Promise<string>;
}

/** A short message for the user, shown once by whichever surface is up (DOM toast on web, Paseo toast on phones). */
export interface Notice {
  key: number;
  agentId: string;
  text: string;
  sub?: string;
  error?: boolean;
}

export interface TreeSnapshot {
  chats: ReadonlyMap<string, ChatSummary>;
  states: ReadonlyMap<string, TreeState>;
  /** The chat whose branch sheet is open on this client. */
  sheetAgentId: string | null;
  /** Chats whose Tree pill shows although they have one branch (/tree asked for the sheet). */
  forced: ReadonlySet<string>;
  /** Chats whose "Summarize them" focus field is open on this client. */
  focusOpen: ReadonlySet<string>;
  /** Chats that just got their summary: the strip says so for a moment. */
  summarized: ReadonlySet<string>;
  /** Moves this client started and still waits on (shown at once, before the next poll). */
  starting: ReadonlyMap<string, OpKind>;
  notices: readonly Notice[];
  /** Web in Paseo's compact (phone) layout: no message icons there, so the pill carries everything. */
  compact: boolean;
  /** Settings → which branch actions show; null until the first chat list arrives. */
  display: TreeDisplay | null;
}

const SLOW_CHATS_MS = 5_000;
const SLOW_STATE_MS = 2_000;
const FAST_MS = 500;
const SUMMARIZED_MS = 2_500;
const STATE_TIMEOUT_MS = 15_000;
/** The server bounds every step (reloads, OMP replies); past these a move is given up on screen. */
const MOVE_LIMIT_MS = 4 * 60_000;
const SUMMARIZE_LIMIT_MS = 20 * 60_000;
/** A move the server neither runs nor finished, this long after it was accepted: the server lost it. */
const LOST_MS = 5_000;

export class TreeStore {
  readonly #transport: TreeTransport;
  #chats = new Map<string, ChatSummary>();
  #states = new Map<string, TreeState>();
  #sheetAgentId: string | null = null;
  #forced = new Set<string>();
  #focusOpen = new Set<string>();
  #summarized = new Set<string>();
  #starting = new Map<string, OpKind>();
  #notices: Notice[] = [];
  #compact = false;
  #display: TreeDisplay | null = null;
  #snapshot: TreeSnapshot;
  readonly #listeners = new Set<() => void>();
  readonly #watched = new Map<string, number>();
  /** Op ids this client started; their outcomes become notices here. */
  readonly #mine = new Set<string>();
  readonly #reported = new Set<string>();
  /** Per chat: the move this client started and still waits on. */
  readonly #tracking = new Map<string, { opId: string; kind: OpKind; since: number }>();
  /** Moves given up on: no longer shown as running even if the server still reports them. */
  readonly #ignored = new Set<string>();
  #noticeKey = 0;
  #disposed = false;
  #chatsTimer: ReturnType<typeof setTimeout> | undefined;
  #stateTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(transport: TreeTransport) {
    this.#transport = transport;
    this.#snapshot = this.#build();
    void this.refreshChats();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): TreeSnapshot => this.#snapshot;

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#chatsTimer);
    clearTimeout(this.#stateTimer);
    this.#listeners.clear();
  }

  /** Keeps a chat's full state fresh while something shows it. */
  watch(agentId: string): () => void {
    this.#watched.set(agentId, (this.#watched.get(agentId) ?? 0) + 1);
    if (this.#watched.get(agentId) === 1) void this.refreshStates();
    return () => {
      const count = (this.#watched.get(agentId) ?? 1) - 1;
      if (count > 0) this.#watched.set(agentId, count);
      else this.#watched.delete(agentId);
    };
  }

  async refreshChats(): Promise<void> {
    if (this.#disposed) return;
    clearTimeout(this.#chatsTimer);
    try {
      const { chats, display } = await this.#transport.chats();
      this.#chats = new Map(chats.map(chat => [chat.agentId, chat]));
      this.#display = display;
      this.#emit();
    } catch {
      // Host offline or plugin reloading: keep what is shown and try again.
    }
    const fast = [...this.#chats.values()].some(chat => chat.phase) || this.#starting.size > 0;
    this.#chatsTimer = setTimeout(() => void this.refreshChats(), fast ? FAST_MS * 2 : SLOW_CHATS_MS);
  }

  async refreshStates(): Promise<void> {
    if (this.#disposed) return;
    clearTimeout(this.#stateTimer);
    const ids = new Set([...this.#watched.keys(), ...this.#starting.keys(), ...(this.#sheetAgentId ? [this.#sheetAgentId] : [])]);
    await Promise.all(
      [...ids].map(async agentId => {
        try {
          // A hung request must not stop the polling loop (and leave a move "running" on screen).
          const state = await Promise.race([
            this.#transport.state(agentId),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), STATE_TIMEOUT_MS)),
          ]);
          this.#states.set(agentId, this.#settle(agentId, state));
        } catch {
          // Keep the last state.
        }
      }),
    );
    this.#emit();
    const fast = [...ids].some(id => this.#states.get(id)?.op || this.#starting.has(id));
    this.#stateTimer = setTimeout(() => void this.refreshStates(), fast ? FAST_MS : SLOW_STATE_MS);
  }

  /**
   * Turns finished moves this client started into notices, and gives up on a move whose end it
   * cannot see: one running far too long, or one the server no longer knows (plugin restarted).
   * Returns the state to show: a move given up on no longer dims the chat.
   */
  #settle(agentId: string, state: TreeState): TreeState {
    if (state.op && this.#ignored.has(state.op.id)) state = { ...state, op: null };
    if (state.op) this.#starting.delete(agentId);
    const last = state.last;
    const mine = this.#tracking.get(agentId);
    if (last && !this.#reported.has(last.id) && this.#mine.has(last.id)) {
      this.#reported.add(last.id);
      this.#starting.delete(agentId);
      if (mine?.opId === last.id) this.#tracking.delete(agentId);
      this.#report(agentId, last);
      return state;
    }
    if (!mine) return state;
    const age = Date.now() - mine.since;
    let giveUp: string | undefined;
    if (state.op?.id === mine.opId) {
      if (age > (mine.kind === "summarize" || state.op.phase === "summarizing" ? SUMMARIZE_LIMIT_MS : MOVE_LIMIT_MS)) {
        giveUp = "The branch switch is taking too long. Reload the chat if it looks wrong.";
      }
    } else if (!state.op && last?.id !== mine.opId && age > LOST_MS) {
      giveUp = "Lost track of the branch switch (the plugin restarted?). Reload the chat if it looks wrong.";
    }
    if (!giveUp) return state;
    this.#ignored.add(mine.opId);
    this.#tracking.delete(agentId);
    this.#starting.delete(agentId);
    this.notify(agentId, giveUp, undefined, true);
    return state.op?.id === mine.opId ? { ...state, op: null } : state;
  }

  #report(agentId: string, last: Outcome): void {
    if (last.status === "error") this.notify(agentId, last.error ?? "The branch switch failed.", undefined, true);
    else if (last.status === "cancelled") this.notify(agentId, "Cancelled", "you stayed on this branch");
    else if (last.kind === "summarize") {
      this.#summarized.add(agentId);
      setTimeout(() => {
        this.#summarized.delete(agentId);
        this.#emit();
      }, SUMMARIZED_MS);
    }
  }

  notify(agentId: string, text: string, sub?: string, error?: boolean): void {
    this.#notices = [...this.#notices, { key: ++this.#noticeKey, agentId, text, ...(sub ? { sub } : {}), ...(error ? { error } : {}) }];
    this.#emit();
  }

  /** The surface that showed a notice removes it. */
  takeNotice(key: number): void {
    this.#notices = this.#notices.filter(notice => notice.key !== key);
    this.#emit();
  }

  async #run(agentId: string, kind: OpKind, call: () => Promise<string>): Promise<void> {
    this.#starting.set(agentId, kind);
    this.#focusOpen.delete(agentId);
    this.#emit();
    try {
      const opId = await call();
      this.#mine.add(opId);
      this.#tracking.set(agentId, { opId, kind, since: Date.now() });
      void this.refreshStates();
      void this.refreshChats();
    } catch (error) {
      this.#starting.delete(agentId);
      this.notify(agentId, error instanceof Error ? error.message : String(error), undefined, true);
    }
  }

  /** Settings → Summarize when going back decides whether a move (not Undo) also summarizes what it leaves. */
  goto(agentId: string, kind: "continue" | "reask" | "switch" | "undo", target?: string): Promise<void> {
    this.closeSheet();
    const summarize = kind !== "undo" && (this.#display?.summarizeOnBack ?? true);
    return this.#run(agentId, kind, () => this.#transport.goto(agentId, kind, target, summarize));
  }

  summarize(agentId: string, focus: string): Promise<void> {
    return this.#run(agentId, "summarize", () => this.#transport.summarize(agentId, focus));
  }

  async cancel(agentId: string): Promise<void> {
    try {
      await this.#transport.cancel(agentId);
    } catch (error) {
      this.notify(agentId, error instanceof Error ? error.message : String(error), undefined, true);
    }
  }

  async dismiss(agentId: string): Promise<void> {
    this.#focusOpen.delete(agentId);
    const state = this.#states.get(agentId);
    if (state) this.#states.set(agentId, { ...state, offer: null });
    this.#emit();
    await this.#transport.dismiss(agentId).catch(error => this.notify(agentId, String(error), undefined, true));
    void this.refreshChats();
  }

  async openTab(agentId: string, entryId: string, before: boolean): Promise<string | undefined> {
    this.closeSheet();
    try {
      return await this.#transport.openTab(agentId, entryId, before);
    } catch (error) {
      this.notify(agentId, error instanceof Error ? error.message : String(error), undefined, true);
      return undefined;
    }
  }

  openSheet(agentId: string): void {
    this.#sheetAgentId = agentId;
    this.#forced.add(agentId);
    this.#emit();
    void this.refreshStates();
  }

  closeSheet(): void {
    if (this.#sheetAgentId) this.#forced.delete(this.#sheetAgentId);
    this.#sheetAgentId = null;
    this.#emit();
  }

  setCompact(compact: boolean): void {
    if (compact === this.#compact) return;
    this.#compact = compact;
    this.#emit();
  }

  setFocusOpen(agentId: string, open: boolean): void {
    if (open) this.#focusOpen.add(agentId);
    else this.#focusOpen.delete(agentId);
    this.#emit();
  }

  readonly #hosts = new Map<string, symbol[]>();

  /** Several composers can show one chat (split panes); only the first mounted pill hosts its sheet. */
  claimHost(agentId: string, token: symbol): () => void {
    this.#hosts.set(agentId, [...(this.#hosts.get(agentId) ?? []), token]);
    this.#emit();
    return () => {
      const rest = (this.#hosts.get(agentId) ?? []).filter(other => other !== token);
      if (rest.length) this.#hosts.set(agentId, rest);
      else this.#hosts.delete(agentId);
      this.#emit();
    };
  }

  isHost(agentId: string, token: symbol): boolean {
    return this.#hosts.get(agentId)?.[0] === token;
  }

  #build(): TreeSnapshot {
    return {
      chats: new Map(this.#chats),
      states: new Map(this.#states),
      sheetAgentId: this.#sheetAgentId,
      forced: new Set(this.#forced),
      focusOpen: new Set(this.#focusOpen),
      summarized: new Set(this.#summarized),
      starting: new Map(this.#starting),
      notices: this.#notices,
      compact: this.#compact,
      display: this.#display,
    };
  }

  #emit(): void {
    this.#snapshot = this.#build();
    for (const listener of this.#listeners) listener();
  }
}
