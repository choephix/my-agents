import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveState, jobTexts, nearestTangent, parseTanLines, TanSessions, type DeliveredJob } from "./tan-sessions";

const line = (entry: object) => JSON.stringify(entry);
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 23, 9, 0, seconds)).toISOString();
const assistant = (seconds: number, stopReason: string, content: object[]) =>
  line({ type: "message", timestamp: at(seconds), message: { role: "assistant", model: "claude-haiku-5-5", stopReason, content } });

// A Tan file: the parent's forked history first (with its own replies), then the tangent.
const TAN_LINES = [
  line({ type: "session", timestamp: at(0) }),
  assistant(0, "stop", [{ type: "text", text: "A reply from the parent chat" }]),
  line({ type: "session_init", timestamp: at(1), task: "Put this up on my droplet." }),
  line({ type: "message", timestamp: at(1), message: { role: "user", content: [{ type: "text", text: "Put this up on my droplet." }] } }),
  assistant(3, "toolUse", [
    { type: "text", text: "Copying the page." },
    { type: "toolCall", name: "bash", arguments: { i: "Syncing the page to the droplet", command: "rsync -av …" } },
  ]),
  line({ type: "message", timestamp: at(9), message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "x".repeat(50) }] } }),
];
const FINISHED = [...TAN_LINES, assistant(12, "stop", [{ type: "text", text: "Published." }]), line({ type: "custom", customType: "session_exit", timestamp: at(12) })];

describe("parseTanLines", () => {
  it("reads only the tangent's own part and names each tool call by its intent", () => {
    const transcript = parseTanLines(TAN_LINES);
    expect(transcript?.work).toBe("Put this up on my droplet.");
    expect(transcript?.steps).toEqual([{ text: "Copying the page." }, { tool: "bash", text: "Syncing the page to the droplet" }]);
    expect(transcript?.final).toBeUndefined();
  });
});

describe("deriveState", () => {
  const delivered = (status: string, text: string): DeliveredJob => ({ jobId: "bg_1", status, agentId: "Tan-a1", durationMs: 11_000, text });

  it("a finished tangent reports its own full answer, not the delivery's possibly truncated copy", () => {
    const state = deriveState("Tan-a1", parseTanLines(FINISHED), delivered("completed", "Publi…[Output truncated]"), true);
    expect(state).toMatchObject({ status: "done", result: "Published.", durationMs: 11_000 });
  });

  it("a failed job shows OMP's error", () => {
    const state = deriveState("Tan-a1", parseTanLines(TAN_LINES), delivered("failed", "No API key"), true);
    expect(state).toMatchObject({ status: "failed", result: "No API key" });
  });

  it("without a delivery, the tangent's own exit decides", () => {
    expect(deriveState("Tan-a1", parseTanLines(FINISHED), undefined, false)).toMatchObject({ status: "done", durationMs: 11_000 });
    const aborted = [...TAN_LINES, assistant(5, "aborted", []), line({ type: "custom", customType: "session_exit", timestamp: at(5) })];
    expect(deriveState("Tan-a1", parseTanLines(aborted), undefined, true)).toMatchObject({ status: "stopped" });
  });

  it("an unfinished tangent is running only while an OMP process that could run it is alive", () => {
    expect(deriveState("Tan-a1", parseTanLines(TAN_LINES), undefined, true)?.status).toBe("running");
    expect(deriveState("Tan-a1", parseTanLines(TAN_LINES), undefined, false)).toMatchObject({ status: "stopped", durationMs: 8_000 });
  });
});

describe("jobTexts", () => {
  it("splits a delivery of several jobs into each job's result", () => {
    const content =
      "<system-notice>\n2 background jobs have completed. Resume your work using the results below.\n\n── Job bg_2 (/tan Reply A) ──\nA\n── Job bg_3 (/tan Reply (B)) ──\nB\nmore\n</system-notice>";
    expect([...jobTexts(content, ["bg_2", "bg_3"])]).toEqual([["bg_2", "A"], ["bg_3", "B\nmore"]]);
    expect(jobTexts("<system-notice>\nBackground job bg_1 has completed. Resume your work using the result below.\nDone\n</system-notice>", ["bg_1"]).get("bg_1")).toBe("Done");
  });
});

describe("nearestTangent", () => {
  it("picks the tangent that started closest to the notice, within 10 s", () => {
    const starts = new Map([["Tan-a", 1_000], ["Tan-b", 6_000]]);
    expect(nearestTangent(starts, 6_020)).toBe("Tan-b");
    expect(nearestTangent(starts, 30_000)).toBeUndefined();
  });
});

describe("TanSessions", () => {
  let root: string | undefined;
  afterEach(async () => root && rm(root, { recursive: true, force: true }));

  it("finds a chat's tangents through Paseo's agent record and reads deliveries as the file grows", async () => {
    root = await mkdtemp(join(tmpdir(), "tan-sessions-"));
    const parent = join(root, "omp", "chat.jsonl");
    await mkdir(join(root, "omp", "chat"), { recursive: true });
    await mkdir(join(root, "agents", "project"), { recursive: true });
    await writeFile(join(root, "agents", "project", "agent-1.json"), JSON.stringify({ persistence: { nativeHandle: parent } }));
    await writeFile(join(root, "omp", "chat", "Tan-a1.jsonl"), `${FINISHED.join("\n")}\n`);
    const delivery = line({
      type: "custom_message",
      customType: "async-result",
      timestamp: at(12),
      content: "<system-notice>\nBackground job bg_1 has completed. Resume your work using the result below.\nPublished.\n</system-notice>",
      details: { jobs: [{ jobId: "bg_1", status: "completed", agentId: "Tan-a1", durationMs: 11_000 }] },
    });
    // The delivery line is still being written.
    await writeFile(parent, `${line({ type: "session", timestamp: at(0) })}\n${delivery.slice(0, 40)}`);

    const sessions = new TanSessions({ PASEO_HOME: root });
    expect(await sessions.parentFile("agent-1")).toBe(parent);
    expect(await sessions.deliveries(parent)).toEqual([]);
    await appendFile(parent, `${delivery.slice(40)}\n`);
    expect((await sessions.deliveries(parent)).map(d => d.jobs.map(job => job.agentId))).toEqual([["Tan-a1"]]);
    expect(await sessions.tangentStarts(parent)).toEqual(new Map([["Tan-a1", Date.parse(at(0))]]));
    expect((await sessions.transcript(parent, "Tan-a1"))?.final?.text).toBe("Published.");
  });
});
