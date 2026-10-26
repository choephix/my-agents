import { describe, expect, test } from "vitest";
import { type Entry, MARKER_TYPE, SessionTree } from "./session-file";

let clock = Date.parse("2026-10-21T15:00:00Z");
const at = () => new Date((clock += 60_000)).toISOString();
const user = (id: string, parentId: string | null, text: string): Entry => ({ type: "message", id, parentId, timestamp: at(), message: { role: "user", content: [{ type: "text", text }] } });
const reply = (id: string, parentId: string, text: string): Entry => ({ type: "message", id, parentId, timestamp: at(), message: { role: "assistant", content: [{ type: "text", text }] } });
const custom = (id: string, parentId: string, customType: string, data: unknown = {}): Entry => ({ type: "custom", id, parentId, customType, data });

/** u1 → a1 → pin → u2 → a2 → u3 → a3, then a move back to a1 (marker) as OMP's extension writes it. */
function chat(): Entry[] {
  return [
    { type: "model_change", id: "m0", parentId: null },
    user("u1", "m0", "Plan a rename CLI"),
    reply("a1", "u1", "Plan: EXIF date names"),
    { type: "credential_pin", id: "pin", parentId: "a1" },
    user("u2", "pin", "Add collision handling"),
    reply("a2", "u2", "Done, -1 and -2"),
    user("u3", "a2", "Read each folder once"),
    reply("a3", "u3", "HashSet per folder"),
    custom("exit", "a3", "session_exit"),
  ];
}

describe("SessionTree", () => {
  test("leaf is the last line; a model_usage line points at its active leaf", () => {
    expect(new SessionTree(chat()).leafId).toBe("exit");
    const withUsage = [...chat(), { type: "model_usage", id: "mu", parentId: "exit", activeLeafId: "a3" }];
    expect(new SessionTree(withUsage).leafId).toBe("a3");
  });

  test("turns end at their last reply", () => {
    const turns = new SessionTree(chat()).turns();
    expect(turns.map(turn => [turn.userId, turn.lastId])).toEqual([["u1", "a1"], ["u2", "a2"], ["u3", "a3"]]);
  });

  test("going back: an offer with the set-aside count, and a pending branch", () => {
    const entries = [...chat(), custom("mk", "a1", MARKER_TYPE, { v: 1, op: "goto", kind: "continue", from: "exit", fork: "a1", requestId: "r1" })];
    const tree = new SessionTree(entries);
    expect(tree.currentMarker()?.id).toBe("mk");
    expect(tree.setAside("exit", "a1")).toBe(4);
    const branches = tree.branches();
    expect(branches.map(branch => [branch.title, branch.messages, branch.current, branch.pending])).toEqual([
      ["Plan a rename CLI", 6, false, false],
      ["New branch after “Plan: EXIF date names”", 0, true, true],
    ]);
    expect(branches[0].target).toBe("exit");
  });

  test("the reload's hidden context message after a move keeps the offer and adds no branch", () => {
    const entries: Entry[] = [
      ...chat(),
      custom("mk", "a1", MARKER_TYPE, { v: 1, op: "goto", kind: "continue", from: "exit", fork: "a1", requestId: "r1" }),
      custom("exit2", "mk", "session_exit"),
      { type: "custom_message", id: "ctx", parentId: "exit2", customType: "eval-state-context", content: "<system-reminder>…</system-reminder>", display: false },
    ];
    const tree = new SessionTree(entries);
    expect(tree.currentMarker()?.id).toBe("mk");
    expect(tree.branches().map(branch => [branch.title, branch.current, branch.pending])).toEqual([
      ["Plan a rename CLI", false, false],
      ["New branch after “Plan: EXIF date names”", true, true],
    ]);
  });

  test("a message sent after going back ends the offer and makes a second branch", () => {
    const entries = [
      ...chat(),
      custom("mk", "a1", MARKER_TYPE, { v: 1, op: "goto", kind: "continue", from: "exit", fork: "a1", requestId: "r1" }),
      user("u4", "mk", "Use millisecond timestamps"),
      reply("a4", "u4", "SubSecTime it is"),
    ];
    const tree = new SessionTree(entries);
    expect(tree.currentMarker()).toBeUndefined();
    const branches = tree.branches();
    expect(branches.map(branch => [branch.title, branch.messages, branch.current])).toEqual([
      ["Add collision handling", 4, false],
      ["Use millisecond timestamps", 2, true],
    ]);
    // Switching back sets aside only the other branch.
    expect(tree.setAside("a4", "exit")).toBe(2);
  });

  test("summarized branches are tagged; replayed fallback rows map to their entries", () => {
    const entries = [
      ...chat(),
      { type: "branch_summary", id: "sum", parentId: "a1", summary: "Left: collision handling" },
      custom("mk", "sum", MARKER_TYPE, { v: 1, op: "summarize", from: "exit", fork: "a1", focus: "speed", summaryId: "sum", requestId: "r2" }),
    ];
    const tree = new SessionTree(entries);
    expect(tree.branches().find(branch => !branch.pending)?.summarized).toBe(true);
    // Paseo numbers id-less fallback rows on the path: credential_pin is not on it any more, the summary is #1.
    expect(tree.replayedFallback("omp-custom-1")?.id).toBe("sum");
    expect(tree.replayedFallback("omp-custom-2")).toBeUndefined();
  });
});
