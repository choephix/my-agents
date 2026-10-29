// @vitest-environment jsdom
import { settingsRpc } from "@getpaseo/plugin";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import contribute from "../index.client";
import { DEFAULTS, preferences } from "../shared/preferences";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("./settings", () => ({ createSettingsScreen: () => () => null }));
vi.mock("./phone", () => ({ contributePhone: () => () => {} }));

const rpcs = settingsRpc(preferences.id);
type WriteResult = { status: "saved" | "conflict" | "invalid"; revision?: string; values?: unknown; error?: string };

/** A client whose settings RPC answers from `stored` and whose writes follow `writes` in order. */
function fakeClient(writes: WriteResult[]) {
  const stored = { revision: "r1", values: { ...DEFAULTS, enabled: true } };
  const items = new Map<string, { onSelect(context: unknown): Promise<void> | void }>();
  const rpc = vi.fn(async (contract: { name: string }, input: { values?: typeof stored.values }) => {
    if (contract.name === rpcs.read.name) return { status: "ready", revision: stored.revision, values: stored.values };
    const result = writes.shift() ?? { status: "saved" };
    if (result.status === "saved" && input.values) stored.values = input.values;
    return result;
  });
  const client = {
    rpc,
    paseo: { agents: { list: () => new Promise(() => {}) } },
    addSettingsScreen: () => () => {},
    addScreen: () => () => {},
    addCommandCenterItem: (item: { id: string; onSelect(context: unknown): Promise<void> | void }) => {
      items.set(item.id, item);
      return () => {};
    },
  };
  return { client, rpc, stored, toggle: () => items.get("toggle")!.onSelect({ context: "global" }) };
}

const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

let stop: (() => void) | null = null;
beforeEach(() => {
  document.body.innerHTML = "";
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { stop?.(); stop = null; vi.unstubAllGlobals(); });

describe("⌘K Toggle tab dots", () => {
  // A save that lost a revision race with another window used to do nothing, silently.
  test("retries once when another window saved first", async () => {
    const fake = fakeClient([{ status: "conflict", error: "stale" }]);
    stop = contribute(fake.client as never);
    await flush();
    await fake.toggle();
    expect(fake.stored.values.enabled).toBe(false);
  });

  test("when saving fails, the change is undone and the command reports an error", async () => {
    const fake = fakeClient([{ status: "invalid", error: "nope" }]);
    stop = contribute(fake.client as never);
    await flush();
    await expect(fake.toggle()).rejects.toThrow(/couldn't save "off"/);
    expect(fake.stored.values.enabled).toBe(true);
  });
});
