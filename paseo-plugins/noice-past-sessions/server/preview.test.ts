import { appendFile, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { previewText, stripMarkdown, stripWrappers, summarizeTail, TAIL_BYTES, TailCache } from "./preview";

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
// OMP transcript records; assistant content mixes thinking, text and tool calls.
const ompReply = (text: string, timestamp?: string) =>
  line({
    type: "message",
    ...(timestamp ? { timestamp } : {}),
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text }, { type: "toolCall", name: "read" }],
    },
  });
const ompUser = (text: string) => line({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
const reply = (tail: string, startsMidFile = false) => summarizeTail(tail, startsMidFile).reply;
// Claude Code transcript record.
const claudeReply = (text: string, extra: object = {}) =>
  line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] }, ...extra });

describe("stripMarkdown", () => {
  it("turns headings, lists, quotes, emphasis, links and inline code into plain prose", () => {
    const markdown = [
      "## Done",
      "",
      "- **Pushed** `main` to [GitHub](https://github.com/x/y).",
      "1. Checked _twice_; snake_case_names stay.",
      "> quoted ~~old~~ note",
      "![shot](a.png)",
    ].join("\n");
    expect(stripMarkdown(markdown)).toBe(
      "Done Pushed main to GitHub. Checked twice; snake_case_names stay. quoted old note shot",
    );
  });

  it("drops fenced code (closed or cut off), rules and table separators; keeps table cells", () => {
    const markdown = [
      "Before.",
      "```ts",
      "const hidden = 1;",
      "```",
      "| File | Change |",
      "|---|:---:|",
      "| a.ts | fixed |",
      "---",
      "After.",
      "```",
      "unterminated",
    ].join("\n");
    expect(stripMarkdown(markdown)).toBe("Before. File · Change a.ts · fixed After.");
  });
});

describe("stripWrappers", () => {
  it("removes harness wrapper blocks, closed or running to the end, but not ordinary tags", () => {
    const text = "<paseo-system>\nAgent X finished.\n<agent-response>long</agent-response>\n</paseo-system>Real answer <b>here</b>. <system-notice>cut";
    expect(stripWrappers(text).trim()).toBe("Real answer <b>here</b>.");
  });

  it("removes OMP /prose tool-call records", () => {
    const text = "> [ran read notes.md; recover: artifact://0:3-40]\n> [ran bash ls; recover: artifact://0:42-77]\n\nAll done.";
    expect(previewText(text)).toBe("All done.");
  });
});

describe("previewText", () => {
  it("is null when only wrappers and code remain", () => {
    expect(previewText("<system-notice>Job done</system-notice>\n```\ncode\n```")).toBeNull();
  });

  it("caps long replies at a word boundary", () => {
    const text = previewText("word ".repeat(200)) ?? "";
    expect(text.length).toBeLessThanOrEqual(400);
    expect(text.endsWith("word")).toBe(true);
  });
});

describe("summarizeTail", () => {
  it("takes the newest assistant text, skipping user turns and replies without text", () => {
    const tail =
      ompReply("First answer.") +
      ompUser("Thanks") +
      ompReply("**Second** answer.") +
      line({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "bash" }] } }) +
      line({ type: "custom_message", content: "<irc>ping</irc>" });
    expect(reply(tail)).toBe("Second answer.");
  });

  it("reads Claude Code transcripts and ignores sidechain (subagent) replies", () => {
    const tail = claudeReply("Main thread reply.") + claudeReply("Subagent chatter.", { isSidechain: true });
    expect(reply(tail)).toBe("Main thread reply.");
  });

  it("skips the partial first line of a tail that starts mid-file", () => {
    // The tail begins inside a reply; its visible end parses as JSON but is not a whole record.
    const cut = ompReply("Cut reply.").slice(10);
    expect(reply(cut, true)).toBeNull();
    expect(reply(cut + ompReply("Whole reply."), true)).toBe("Whole reply.");
  });

  it("returns null when the tail has no assistant text", () => {
    expect(reply(ompUser("Only a question"))).toBeNull();
  });

  it("dates the session by its newest message, not by exit records or the file's mtime", () => {
    const tail =
      ompUser("Question?") +
      ompReply("Answer.", "2026-10-17T12:20:00.000Z") +
      // OMP appends these when the terminal running an old session is killed, days later.
      line({ type: "custom", customType: "session_exit", timestamp: "2026-10-19T13:18:49.925Z" }) +
      line({ type: "title", title: "no timestamp" });
    expect(summarizeTail(tail, false)).toEqual({ reply: "Answer.", lastActiveAt: "2026-10-17T12:20:00.000Z" });
    // Without any message in the tail, the newest record still dates it.
    expect(summarizeTail(line({ type: "custom", timestamp: "2026-10-19T13:18:49.925Z" }), false).lastActiveAt).toBe(
      "2026-10-19T13:18:49.925Z",
    );
  });
});

describe("TailCache", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "past-sessions-preview-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads only the last TAIL_BYTES: an early reply beyond the window is not found", async () => {
    const file = path.join(dir, "s.jsonl");
    await writeFile(file, ompReply("Early reply.") + ompUser("x".repeat(TAIL_BYTES)));
    expect((await new TailCache().summary(file)).reply).toBeNull();
  });

  it("re-reads a file after it grows", async () => {
    const file = path.join(dir, "s.jsonl");
    await writeFile(file, ompReply("One."));
    const cache = new TailCache();
    expect((await cache.summary(file)).reply).toBe("One.");
    await appendFile(file, ompReply("Two."));
    const later = new Date(Date.now() + 5_000);
    await utimes(file, later, later);
    expect((await cache.summary(file)).reply).toBe("Two.");
  });

  it("is empty for a missing file", async () => {
    expect(await new TailCache().summary(path.join(dir, "missing.jsonl"))).toEqual({ reply: null, lastActiveAt: null });
  });
});
