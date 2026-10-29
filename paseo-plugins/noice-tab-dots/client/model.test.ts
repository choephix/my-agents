import { describe, expect, test } from "vitest";
import { type AgentInfo, isLightText, unreadList, unreadListKey } from "./model";

const tab = (id: string, extra: Partial<AgentInfo> = {}): AgentInfo => ({
  id, workspaceId: "wks_1", parentId: null, title: id, status: "idle", requiresAttention: false,
  attentionReason: null, pendingPermissions: 0, at: "2026-10-20T10:00:00.000Z", ...extra,
});
const mapOf = (...agents: AgentInfo[]) => new Map(agents.map((agent) => [agent.id, agent]));

describe("unreadListKey", () => {
  // The phone skips agent updates whose key is unchanged, so an equal key must mean an equal
  // list in every mode; otherwise a visible change would be dropped.
  const before = mapOf(
    tab("read"),
    tab("unread", { requiresAttention: true, attentionReason: "finished" }),
    tab("running", { status: "running" }),
    tab("child", { parentId: "running", requiresAttention: true, attentionReason: "finished" }),
  );
  const change = (id: string, extra: Partial<AgentInfo>) => new Map(before).set(id, { ...before.get(id)!, ...extra });
  const lists = (agents: Map<string, AgentInfo>) =>
    JSON.stringify((["unread", "unread-running", "all"] as const).map((show) => unreadList(agents, show)));

  test.each([
    ["a sub-agent update", change("child", { at: "2026-10-20T11:00:00.000Z", title: "new" })],
    ["a read tab's timestamp", change("read", { at: "2026-10-20T11:00:00.000Z" })],
  ])("ignores %s, and the lists agree", (_name, after) => {
    expect(unreadListKey(after)).toBe(unreadListKey(before));
    expect(lists(after)).toBe(lists(before));
  });

  test.each([
    ["a running tab's timestamp", change("running", { at: "2026-10-20T11:00:00.000Z" })],
    ["an unread tab's title", change("unread", { title: "renamed" })],
    ["a tab being read", change("unread", { requiresAttention: false, attentionReason: null })],
    ["a tab starting to run", change("read", { status: "running" })],
  ])("notices %s", (_name, after) => {
    expect(unreadListKey(after)).not.toBe(unreadListKey(before));
  });
});

describe("isLightText", () => {
  // Plugin themes may use short hex (Paseo's own fixtures use "#fff"); the phone's running-dot
  // colour used to read "#fff" as dark text and pick the light-theme blue on dark themes.
  test.each([
    ["#fff", true],
    ["#FFFFFF", true],
    ["#f9f8fbcc", true],
    ["rgb(249, 248, 251)", true],
    ["rgba(250, 250, 250, 0.9)", true],
    ["#000", false],
    ["#1a1a1e", false],
    ["rgb(26, 26, 30)", false],
  ])("%s → %s", (color, light) => {
    expect(isLightText(color)).toBe(light);
  });
});
