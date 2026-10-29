import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { chooseDelivery, deliveryText, finalReply, formatDuration, formatTangentReport } from "./tangent-report";

const base = { title: "Tangent: check the cache key", durationMs: 125_000, reply: "", link: "https://app.example/h/s/agent/c1" };

describe("formatTangentReport", () => {
  it("hands back the full reply, the duration and the link when the turn completed", () => {
    const text = formatTangentReport({ ...base, outcome: { kind: "completed" }, reply: "  Line one.\n\nLine two.  " });
    expect(text).toBe(`Tangent "Tangent: check the cache key" finished (2m 5s):\n\nLine one.\n\nLine two.\n\nOpen the tangent: ${base.link}`);
  });

  it("says so when a completed turn produced no text", () => {
    expect(formatTangentReport({ ...base, outcome: { kind: "completed" }, reply: " \n" })).toContain("(It ended without a text reply.)");
  });

  it("reports a failure with its error instead of a reply", () => {
    const text = formatTangentReport({ ...base, outcome: { kind: "failed", message: "rate limited" }, reply: "partial" });
    expect(text).toBe(`Tangent "Tangent: check the cache key" failed after 2m 5s: rate limited\n\nOpen the tangent: ${base.link}`);
  });

  it("reports a stopped or archived tangent without its partial text", () => {
    expect(formatTangentReport({ ...base, outcome: { kind: "canceled" }, reply: "partial" })).toBe(`Tangent "Tangent: check the cache key" was stopped after 2m 5s, before it finished.\n\nOpen the tangent: ${base.link}`);
    expect(formatTangentReport({ ...base, outcome: { kind: "archived" }, reply: "partial" })).toContain("was archived after 2m 5s, before it finished.");
  });
});

describe("formatDuration", () => {
  it.each([[0, "0s"], [59_400, "59s"], [59_600, "1m 0s"], [3_599_000, "59m 59s"], [3_660_000, "1h 1m"]])("%i ms → %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("finalReply", () => {
  const user = (text: string): AgentTimelineItem => ({ type: "user_message", text });
  const say = (text: string): AgentTimelineItem => ({ type: "assistant_message", text });
  const think: AgentTimelineItem = { type: "reasoning", text: "hmm" };
  const tool = { type: "tool_call", callId: "t1", name: "read", status: "completed", detail: { type: "unknown", input: null, output: null }, error: null } as AgentTimelineItem;

  it("keeps only the text after the turn's last tool call", () => {
    expect(finalReply([user("task"), say("Let me look."), tool, say("The answer"), think, say(" is 42.")])).toBe("The answer is 42.");
  });

  it("ignores the parent's history before the tangent's own task", () => {
    expect(finalReply([user("old"), say("old reply"), user("task")])).toBe("");
  });
});

describe("delivery", () => {
  it("queues behind OMP's running reply with /follow-up, whatever its state", () => {
    expect(chooseDelivery("omp", "running")).toBe("follow-up");
    expect(chooseDelivery("omp", "idle")).toBe("follow-up");
    expect(deliveryText("follow-up", ["A"])).toBe("/follow-up A");
  });

  it("holds reports for a busy non-OMP parent and sends to an idle one", () => {
    expect(chooseDelivery("codex", "running")).toBe("wait-for-idle");
    expect(chooseDelivery("claude", "initializing")).toBe("wait-for-idle");
    expect(chooseDelivery("claude", "idle")).toBe("send-now");
    expect(chooseDelivery("claude", "closed")).toBe("send-now");
  });

  it("combines held reports into one message so a second send cannot interrupt the first", () => {
    expect(deliveryText("send-now", ["A", "B"])).toBe("A\n\n---\n\nB");
  });
});
