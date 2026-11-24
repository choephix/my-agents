import { afterEach, describe, expect, it, vi } from "vitest";
import type { BtwChatSnapshot, BtwEntry } from "../shared/btw";
import {
  ASK_TIMEOUT_MS,
  BtwStore,
  type BtwTransport,
  formatDuration,
  formatElapsed,
  type PendingAsk,
  settlePending,
} from "./btw-store";

function entry(id: string, question: string, patch: Partial<BtwEntry> = {}): BtwEntry {
  return { id, question, answer: "", status: "running", createdAt: 1, updatedAt: 1, ...patch };
}

function ask(key: string, question: string, knownIds: string[] | null, sentAt = 0): PendingAsk {
  return { key, question, knownIds: knownIds && new Set(knownIds), sentAt };
}

describe("settlePending", () => {
  it("settles an ask with the first new record for its question, not an older identical one", () => {
    const old = entry("old", "same?");
    expect(settlePending([ask("a", "same?", ["old"])], [old], 10)).toHaveLength(1);
    expect(settlePending([ask("a", "same?", ["old"])], [entry("new", "same?"), old], 10)).toEqual([]);
  });

  it("lets each new record settle only one of two identical asks", () => {
    const pending = [ask("first", "q", [], 1), ask("second", "q", [], 2)];
    expect(settlePending(pending, [entry("r1", "q")], 10).map(p => p.key)).toEqual(["second"]);
  });

  it("keeps asks still sending, and fails asks whose record never appeared", () => {
    const sending = ask("sending", "q", null, 0);
    const late = ask("late", "q", [], 0);
    const result = settlePending([sending, late], [], ASK_TIMEOUT_MS + 1);
    expect(result.find(p => p.key === "sending")?.error).toBeUndefined();
    expect(result.find(p => p.key === "late")?.error).toMatch(/did not start/);
  });
});

/** A daemon with per-chat outboxes that pushes snapshots to subscribed stores. */
class FakeDaemon implements BtwTransport {
  records = new Map<string, BtwEntry[]>();
  workspaces = new Map<string, string>();
  refuse: string | undefined;
  /** When false, `ask` sends without creating a record (simulates a dropped /btw). */
  autoRecord = true;
  readonly #watchers = new Set<(chats: readonly BtwChatSnapshot[]) => void>();
  #next = 0;

  get watcherCount(): number {
    return this.#watchers.size;
  }

  watch(onSnapshot: (chats: readonly BtwChatSnapshot[]) => void): () => void {
    this.#watchers.add(onSnapshot);
    onSnapshot(this.#snapshot());
    return () => {
      this.#watchers.delete(onSnapshot);
    };
  }

  async list(agentId: string): Promise<BtwEntry[]> {
    return structuredClone(this.records.get(agentId) ?? []);
  }
  async ask(agentId: string, question: string): Promise<void> {
    if (this.refuse) throw new Error(this.refuse);
    if (!this.autoRecord) return;
    const record = entry(`r${this.#next++}`, question, { createdAt: this.#next, updatedAt: this.#next });
    this.records.set(agentId, [record, ...(this.records.get(agentId) ?? [])]);
    this.push();
  }
  async dismiss(agentId: string, id: string): Promise<void> {
    this.records.set(agentId, (this.records.get(agentId) ?? []).filter(e => e.id !== id));
    this.push();
  }
  finish(agentId: string, id: string, answer: string): void {
    const record = this.records.get(agentId)!.find(e => e.id === id)!;
    Object.assign(record, { answer, status: "complete", updatedAt: record.updatedAt + 100 });
    this.push();
  }
  push(): void {
    const snapshot = this.#snapshot();
    for (const watcher of this.#watchers) watcher(structuredClone(snapshot));
  }

  #snapshot(): BtwChatSnapshot[] {
    return [...this.records]
      .filter(([, entries]) => entries.length)
      .map(([agentId, entries]) => ({
        agentId,
        workspaceId: this.workspaces.get(agentId)!,
        entries: structuredClone(entries),
      }));
  }
}

const stores: BtwStore[] = [];
afterEach(() => {
  stores.splice(0).forEach(store => store.dispose());
  vi.useRealTimers();
});

function setup(now?: () => number) {
  const daemon = new FakeDaemon();
  daemon.workspaces.set("chat-a", "ws-1");
  daemon.workspaces.set("chat-b", "ws-2");
  const store = new BtwStore(daemon, now);
  stores.push(store);
  return { daemon, store };
}

describe("BtwStore", () => {
  it("routes two chats' answers to their own chats and settles each ask via push", async () => {
    const { daemon, store } = setup();
    await Promise.all([store.ask("chat-a", "ws-1", "question A"), store.ask("chat-b", "ws-2", "question B")]);
    const [idA] = daemon.records.get("chat-a")!.map(e => e.id);
    daemon.finish("chat-a", idA, "answer A");

    const { chats } = store.getSnapshot();
    expect(chats.get("chat-a")).toMatchObject({ workspaceId: "ws-1", pending: [] });
    expect(chats.get("chat-a")!.entries.map(e => [e.question, e.answer, e.status])).toEqual([
      ["question A", "answer A", "complete"],
    ]);
    expect(chats.get("chat-b")!.entries.map(e => [e.question, e.status])).toEqual([["question B", "running"]]);
  });

  it("shows a refused ask as an error until it is dismissed locally", async () => {
    const { daemon, store } = setup();
    daemon.refuse = "This OMP agent started before /btw was installed.";
    await store.ask("chat-a", "ws-1", "q");
    const [failed] = store.getSnapshot().chats.get("chat-a")!.pending;
    expect(failed.error).toBe(daemon.refuse);

    await store.dismiss("chat-a", failed.key);
    expect(store.getSnapshot().chats.has("chat-a")).toBe(false);
    expect(store.getSnapshot().openAgentId).toBeNull();
  });

  it("drops a chat once its last answer is dismissed, including on other clients", async () => {
    const { daemon, store } = setup();
    const other = new BtwStore(daemon);
    stores.push(other);
    await store.ask("chat-a", "ws-1", "q");
    const [answer] = other.getSnapshot().chats.get("chat-a")!.entries;

    await store.dismiss("chat-a", answer.id);
    expect(store.getSnapshot().chats.has("chat-a")).toBe(false);
    expect(other.getSnapshot().chats.has("chat-a")).toBe(false);
  });

  it("fails a pending ask after ASK_TIMEOUT_MS even with no further server events", async () => {
    vi.useFakeTimers();
    const { daemon, store } = setup(() => Date.now());
    daemon.autoRecord = false;
    await store.ask("chat-a", "ws-1", "ghost?");
    expect(store.getSnapshot().chats.get("chat-a")!.pending[0].error).toBeUndefined();

    vi.advanceTimersByTime(ASK_TIMEOUT_MS + 10);
    expect(store.getSnapshot().chats.get("chat-a")!.pending[0].error).toMatch(/did not start/);
  });

  it("unsubscribes from the daemon on dispose", () => {
    const { daemon, store } = setup();
    expect(daemon.watcherCount).toBe(1);
    store.dispose();
    expect(daemon.watcherCount).toBe(0);
  });

  it("opens the asking chat's sheet and hosts it in the first composer only", async () => {
    const { store } = setup();
    await store.ask("chat-a", "ws-1", "q");
    expect(store.getSnapshot().openAgentId).toBe("chat-a");
    const first = Symbol("first");
    const second = Symbol("second");
    const releaseFirst = store.claimHost("chat-a", first);
    store.claimHost("chat-a", second);
    expect([store.isHost("chat-a", first), store.isHost("chat-a", second)]).toEqual([true, false]);
    releaseFirst();
    expect(store.isHost("chat-a", second)).toBe(true);
  });
});

describe("time labels", () => {
  it("formats a running timer and a finished duration", () => {
    expect([0, 7_400, 83_000].map(formatElapsed)).toEqual(["0:00", "0:07", "1:23"]);
    expect([200, 6_300, 72_000].map(formatDuration)).toEqual(["1s", "6s", "1m 12s"]);
  });
});
