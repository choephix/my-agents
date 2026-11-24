import type { PluginClientContext } from "@getpaseo/plugin/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Overview } from "../shared/rpc";

interface Call {
  name: string;
  input: unknown;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

interface Sub {
  name: string;
  onEvent(event: unknown): void;
  unsubscribed: boolean;
}

let calls: Call[];
let subs: Sub[];
let runtime: typeof import("./runtime");

// `runtime` keeps the newest overview in module state; each test starts from a fresh module.
beforeEach(async () => {
  vi.resetModules();
  runtime = await import("./runtime");
  calls = [];
  subs = [];
  const fake = {
    rpc(contract: { name: string }, input: unknown) {
      // `Promise.withResolvers` needs lib es2024; this tsconfig targets older.
      return new Promise<unknown>((resolve, reject) => calls.push({ name: contract.name, input, resolve, reject }));
    },
    subscribe(contract: { name: string }, _input: unknown, onEvent: (event: unknown) => void) {
      const sub: Sub = { name: contract.name, onEvent, unsubscribed: false };
      subs.push(sub);
      return () => {
        sub.unsubscribed = true;
      };
    },
  };
  runtime.setClient(fake as unknown as PluginClientContext);
});

const overview = (slug: string | null, etag: string): Overview => ({
  home: "/home/user",
  roots: [],
  workspaces: [
    {
      id: "wks_1",
      name: "Example Task",
      projectName: "acme-app",
      dir: "/w",
      root: "/w/.scratch",
      skipped: null,
      binding: slug ? { kind: "effort", root: "/w/.scratch", slug, at: "2026-10-20T00:00:00.000Z" } : null,
      suggestion: null,
    },
  ],
  warnings: [],
  showHeaderButton: true,
  commitsShown: 30,
  etag,
});
const bound = (value: Overview | null) => {
  const binding = value?.workspaces[0].binding;
  return binding?.kind === "effort" ? binding.slug : null;
};
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));
async function loaded(slug: string | null) {
  const first = runtime.fetchOverview();
  calls.shift()!.resolve(overview(slug, "e1"));
  await first;
}

describe("binding a workspace", () => {
  it("is not undone by a poll that was answered before the bind landed", async () => {
    await loaded(null);
    const seen: (string | null)[] = [];
    runtime.onOverview((value) => seen.push(bound(value)));

    const poll = runtime.fetchOverview();
    const binding = runtime.bind("wks_1", { kind: "effort", root: "/w/.scratch", slug: "acme-task" });
    const [pollCall, bindCall] = calls.splice(0, 2);
    expect(bindCall.name).toBe("efforts.bind");
    pollCall.resolve(overview(null, "e2"));
    await poll;
    bindCall.resolve({ ok: true });
    await settle();
    calls.shift()!.resolve(overview("acme-task", "e3"));
    await binding;

    expect(seen).toEqual(["acme-task", "acme-task"]);
    expect(bound(runtime.latestOverview())).toBe("acme-task");
  });

  it("puts the old binding back and throws when the write fails", async () => {
    await loaded("acme-task");
    const binding = runtime.bind("wks_1", { kind: "clear" });
    expect(bound(runtime.latestOverview())).toBeNull();
    calls.shift()!.reject(new Error("EACCES"));
    await expect(binding).rejects.toThrow("EACCES");
    expect(bound(runtime.latestOverview())).toBe("acme-task");
  });
});

describe("polling the overview", () => {
  it("keeps the same object and tells nobody when the server says unchanged", async () => {
    await loaded("acme-task");
    const held = runtime.latestOverview();
    let told = 0;
    runtime.onOverview(() => told++);
    const poll = runtime.fetchOverview();
    const call = calls.shift()!;
    expect(call.input).toEqual({ since: "e1" });
    call.resolve({ unchanged: true, etag: "e1" });
    expect(await poll).toBe(held);
    expect(told).toBe(0);
  });
});

describe("overview push subscription", () => {
  it("publishes pushed updates, skips duplicate etags, and stops after unsubscribe", () => {
    const seen: (string | null)[] = [];
    runtime.onOverview((value) => seen.push(bound(value)));
    const stop = runtime.startOverviewWatch(runtime.client());

    expect(subs).toHaveLength(1);
    expect(subs[0].name).toBe("efforts.overview.watch");

    const first = overview("acme-task", "e1");
    subs[0].onEvent(first);
    expect(runtime.latestOverview()).toBe(first);
    expect(seen).toEqual(["acme-task"]);

    // Identical etag keeps object identity and notifies nobody.
    subs[0].onEvent(overview("acme-task", "e1"));
    expect(runtime.latestOverview()).toBe(first);
    expect(seen).toEqual(["acme-task"]);

    // Changed etag publishes immediately.
    const second = overview("beta-task", "e2");
    subs[0].onEvent(second);
    expect(runtime.latestOverview()).toBe(second);
    expect(seen).toEqual(["acme-task", "beta-task"]);

    stop();
    expect(subs[0].unsubscribed).toBe(true);
    subs[0].onEvent(overview("gamma-task", "e3"));
    expect(runtime.latestOverview()).toBe(second);
  });

  it("ignores stale pushes arriving while a bind is settling", async () => {
    const stop = runtime.startOverviewWatch(runtime.client());
    subs[0].onEvent(overview(null, "e1"));
    const seen: (string | null)[] = [];
    runtime.onOverview((value) => seen.push(bound(value)));

    const binding = runtime.bind("wks_1", { kind: "effort", root: "/w/.scratch", slug: "acme-task" });
    // Pre-bind push arrives while `bindRpc` is in flight: must be ignored.
    subs[0].onEvent(overview(null, "e2"));
    expect(bound(runtime.latestOverview())).toBe("acme-task");

    const bindCall = calls.shift()!;
    bindCall.resolve({ ok: true });
    await settle();
    // Stale pre-bind push still in transit before `fetchOverview` confirms: must still be ignored.
    subs[0].onEvent(overview(null, "e2b"));
    expect(bound(runtime.latestOverview())).toBe("acme-task");

    calls.shift()!.resolve(overview("acme-task", "e3"));
    await binding;
    // Daemon's confirming push with the same etag is deduplicated.
    subs[0].onEvent(overview("acme-task", "e3"));

    expect(seen).toEqual(["acme-task", "acme-task"]);
    stop();
  });
});
