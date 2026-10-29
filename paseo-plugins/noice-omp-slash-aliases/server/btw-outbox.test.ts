import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// The writer is the OMP extension's own module: these tests pin the file contract between the two.
import { BtwOutbox, type BtwRecord, writeProcessMarker } from "../../../.omp/extensions/headless-builtins/btw-outbox";
import { dismissEntry, listEntries, markedPids, pruneOutbox, RETENTION_MS, STALE_RUNNING_MS, summarizeChats } from "./btw-outbox";

const roots: string[] = [];
const outboxes: BtwOutbox[] = [];
afterEach(() => {
  outboxes.splice(0).forEach(outbox => outbox.close());
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});

function setup(agentId = "chat-a", onDismissRunning = (_id: string) => {}) {
  const root = mkdtempSync(join(tmpdir(), "omp-btw-"));
  roots.push(root);
  const outbox = new BtwOutbox({ dir: join(root, agentId), agentId, onDismissRunning, throttleMs: 5 });
  outboxes.push(outbox);
  return { root, outbox };
}

function record(id: string, patch: Partial<BtwRecord> = {}): BtwRecord {
  const now = Date.now();
  return { id, question: `q ${id}`, answer: "", status: "running", createdAt: now, updatedAt: now, ...patch };
}

describe("btw outbox contract", () => {
  it("shows what the extension streams, newest question first", async () => {
    const { root, outbox } = setup();
    outbox.record(record("r1", { createdAt: 1 }));
    outbox.record(record("r2", { createdAt: 2 }));
    outbox.delta("r2", "Hello ");
    outbox.delta("r2", "world");
    await vi.waitFor(async () => expect((await listEntries(root, "chat-a"))[0].answer).toBe("Hello world"));
    outbox.record({ ...record("r1", { createdAt: 1 }), answer: "done", status: "complete" });

    const entries = await listEntries(root, "chat-a");
    expect(entries.map(e => [e.id, e.status, e.answer])).toEqual([
      ["r2", "running", "Hello world"],
      ["r1", "complete", "done"],
    ]);
  });

  it("keeps OMP's extra record fields out of the file", async () => {
    const { root, outbox } = setup();
    outbox.record({ ...record("r1"), leafId: "x", followUps: [] } as BtwRecord);
    expect(await listEntries(root, "chat-a")).toHaveLength(1);
  });

  it("never lets one chat's folder show another chat's answer", async () => {
    const { root, outbox } = setup("chat-a");
    outbox.record(record("r1"));
    mkdirSync(join(root, "chat-b"));
    // A copied or misplaced file names its own chat; the reader trusts that over the folder.
    writeFileSync(
      join(root, "chat-b", "r1.json"),
      JSON.stringify({ version: 1, agentId: "chat-a", record: record("r1") }),
    );
    expect(await listEntries(root, "chat-b")).toEqual([]);
    expect(await listEntries(root, "chat-a")).toHaveLength(1);
  });

  it("dismissal hides the answer, cancels it while running, and stops later writes", async () => {
    const cancelled: string[] = [];
    const { root, outbox } = setup("chat-a", id => cancelled.push(id));
    outbox.record(record("r1"));
    await dismissEntry(root, "chat-a", "r1");
    await vi.waitFor(() => expect(cancelled).toEqual(["r1"]));

    outbox.record({ ...record("r1"), status: "cancelled" });
    expect(existsSync(join(root, "chat-a", "r1.json"))).toBe(false);
    expect(await listEntries(root, "chat-a")).toEqual([]);
  });

  it("reports a running answer its process stopped writing as interrupted", async () => {
    const { root, outbox } = setup();
    outbox.record(record("r1", { updatedAt: 1_000 }));
    const [entry] = await listEntries(root, "chat-a", 1_000 + STALE_RUNNING_MS + 1);
    expect(entry.status).toBe("interrupted");
  });

  it("summarizes only chats with undismissed answers", async () => {
    const { root, outbox } = setup();
    outbox.record(record("r1", { status: "complete", updatedAt: 5 }));
    outbox.record(record("r2", { updatedAt: 9 }));
    writeProcessMarker(join(root, "chat-idle"), 123);
    expect(await summarizeChats(root, 10)).toEqual([{ agentId: "chat-a", count: 2, running: true, updatedAt: 9 }]);
  });

  it("rejects ids that could escape the outbox", async () => {
    const { root } = setup();
    await expect(dismissEntry(root, "chat-a", "../../etc")).rejects.toThrow();
    await expect(listEntries(root, "..")).rejects.toThrow();
  });

  it("prunes old answers and dead processes' markers, keeping live ones", async () => {
    const { root, outbox } = setup();
    outbox.record(record("old", { status: "complete" }));
    outbox.record(record("new", { status: "complete" }));
    const longAgo = (Date.now() - RETENTION_MS - 60_000) / 1000;
    utimesSync(join(root, "chat-a", "old.json"), longAgo, longAgo);
    writeProcessMarker(join(root, "chat-a"), 111);
    writeProcessMarker(join(root, "chat-a"), 222);
    writeProcessMarker(join(root, "chat-gone"), 333);

    await pruneOutbox(root, pid => pid === 222);
    expect((await listEntries(root, "chat-a")).map(e => e.id)).toEqual(["new"]);
    expect([...(await markedPids(root, "chat-a"))]).toEqual([222]);
    expect(existsSync(join(root, "chat-gone"))).toBe(false);
  });
});
