import { describe, expect, test } from "vitest";
import { watchAgents } from "./agents";
import type { AgentInfo } from "./model";

const agent = (id: string, title = id) => ({
  id, workspaceId: "wks_1", title, status: "idle", requiresAttention: true, attentionReason: "finished", labels: {},
});
const page = (ids: string[], nextCursor: string | null) => ({
  entries: ids.map((id) => ({ agent: agent(id) })),
  pageInfo: { hasMore: nextCursor !== null, nextCursor, prevCursor: null },
});

/** A fake `paseo.agents` whose subscription hands its observer to the test. */
function fakeSource(pages: Record<string, ReturnType<typeof page>>) {
  let observer: { snapshot(p: unknown): void; update(m: unknown): void } | null = null;
  const pageRequests: string[] = [];
  let releasePage: (() => void) | null = null;
  const source = {
    holdPages: false,
    async list(options: { subscribe?: {}; page?: { cursor: string } }) {
      if (options.subscribe) {
        return { subscription: { subscribe(o: typeof observer) { observer = o; observer!.snapshot(pages.first); return () => {}; } } };
      }
      const cursor = options.page!.cursor;
      pageRequests.push(cursor);
      // Executor form: the plugin typechecks against ES2023, which lacks Promise.withResolvers.
      if (source.holdPages) await new Promise<void>((resolve) => { releasePage = resolve; });
      return pages[cursor];
    },
  };
  return {
    source,
    pageRequests,
    observer: () => observer!,
    releasePage: () => releasePage?.(),
  };
}

/** Lets queued promise callbacks run (no timers involved). */
const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

describe("watchAgents", () => {
  // The daemon pages at 200, newest first; agents past the first page (the longest-waiting
  // unread ones) used to be dropped.
  test("follows the snapshot's further pages", async () => {
    const fake = fakeSource({ first: page(["a", "b"], "c1"), c1: page(["c"], "c2"), c2: page(["d"], null) });
    let latest: ReadonlyMap<string, AgentInfo> = new Map();
    watchAgents(fake.source as never, (agents) => { latest = new Map(agents); });
    await settle();
    expect([...latest.keys()].sort()).toEqual(["a", "b", "c", "d"]);
    expect(fake.pageRequests).toEqual(["c1", "c2"]);
  });

  test("a reconnect snapshot loads its further pages again", async () => {
    const fake = fakeSource({ first: page(["a"], null), again: page(["a2"], "c1"), c1: page(["b2"], null) });
    let latest: ReadonlyMap<string, AgentInfo> = new Map();
    watchAgents(fake.source as never, (agents) => { latest = new Map(agents); });
    await settle();
    fake.observer().snapshot(page(["a2"], "c1"));
    await settle();
    expect([...latest.keys()].sort()).toEqual(["a2", "b2"]);
  });

  test("an update that arrives while a page loads wins over the older page", async () => {
    const fake = fakeSource({ first: page(["a"], "c1"), c1: page(["b", "gone"], null) });
    fake.source.holdPages = true;
    let latest: ReadonlyMap<string, AgentInfo> = new Map();
    watchAgents(fake.source as never, (agents) => { latest = new Map(agents); });
    await settle();
    fake.observer().update({ type: "agent_update", payload: { kind: "upsert", agent: { ...agent("b", "renamed"), requiresAttention: false } } });
    fake.observer().update({ type: "agent_update", payload: { kind: "remove", agentId: "gone" } });
    fake.releasePage();
    await settle();
    expect(latest.get("b")?.title).toBe("renamed");
    expect(latest.get("b")?.requiresAttention).toBe(false);
    expect(latest.has("gone")).toBe(false);
  });
});
