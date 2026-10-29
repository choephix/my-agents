import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HEAD_BYTES, OmpSessionIndex, parseSessionHead } from "./omp-sessions";

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const header = (id: string, cwd: string) =>
  line({ type: "session", version: 3, id, timestamp: "2026-10-18T05:32:50.106Z", cwd });
const userMessage = (text: string) =>
  line({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });

describe("parseSessionHead", () => {
  it("prefers the in-place title record over title changes", () => {
    const head = parseSessionHead(
      line({ type: "title", v: 1, title: "Pinned", pad: "   " }) +
        header("s1", "/w") +
        line({ type: "title_change", title: "Auto" }) +
        userMessage("hello"),
    );
    expect(head).toEqual({
      sessionId: "s1",
      cwd: "/w",
      createdAt: "2026-10-18T05:32:50.106Z",
      title: "Pinned",
      firstPrompt: "hello",
    });
  });

  it("falls back to the latest title_change or session_info when the title record is empty", () => {
    const head = parseSessionHead(
      line({ type: "title", v: 1, title: "" }) +
        header("s1", "/w") +
        line({ type: "title_change", title: "First" }) +
        line({ type: "session_info", name: "Named by /name" }),
    );
    expect(head?.title).toBe("Named by /name");
  });

  it("takes the first user message, ignoring assistant text and a line cut by the read window", () => {
    const head = parseSessionHead(
      header("s1", "/w") +
        line({ type: "message", message: { role: "assistant", content: "hi" } }) +
        userMessage("real question") +
        userMessage("follow-up") +
        '{"type":"message","message":{"role":"user","content":"cut of',
    );
    expect(head?.firstPrompt).toBe("real question");
  });

  it("rejects files without a session header", () => {
    expect(parseSessionHead(userMessage("orphan"))).toBeNull();
  });
});

describe("OmpSessionIndex", () => {
  let root: string;
  let sessions: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "past-sessions-test-"));
    sessions = path.join(root, "sessions");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function session(dir: string, name: string, body: string) {
    await mkdir(path.join(sessions, dir), { recursive: true });
    const file = path.join(sessions, dir, name);
    await writeFile(file, body);
    return file;
  }

  it("lists only top-level sessions whose recorded cwd matches, not nested subagent files", async () => {
    const home = path.join(root, "home");
    const project = path.join(home, "proj");
    const roots = { home, tmp: path.join(root, "no-tmp") };
    await session("-proj", "a_s1.jsonl", header("s1", project) + userMessage("one"));
    await session("-proj", "b_s2.jsonl", header("s2", path.join(home, "other")) + userMessage("wrong cwd"));
    await session("-proj/a_s1", "child.jsonl", header("child", project));
    await session("-proj-sub", "c_s3.jsonl", header("s3", path.join(project, "sub")));

    const index = new OmpSessionIndex(roots);
    const sessionRoots = [{ dir: sessions, provider: "omp" }];
    const folder = await index.list({ sessionRoots, targets: [project], includeSubfolders: false });
    expect(folder.sessions.map((s) => s.sessionId)).toEqual(["s1"]);

    const subtree = await index.list({ sessionRoots, targets: [project], includeSubfolders: true });
    expect(subtree.sessions.map((s) => s.sessionId).sort()).toEqual(["s1", "s3"]);
  });

  it("reads each file once and again only after it changes; the head read is bounded", async () => {
    const home = path.join(root, "home");
    const project = path.join(home, "proj");
    const big = header("s1", project) + userMessage("x".repeat(HEAD_BYTES * 3));
    const file = await session("-proj", "a_s1.jsonl", big);
    const index = new OmpSessionIndex({ home, tmp: path.join(root, "no-tmp") });
    const input = { sessionRoots: [{ dir: sessions, provider: "omp" }], targets: [project], includeSubfolders: false };

    const first = await index.list(input);
    expect(first.stats.filesRead).toBe(1);
    // The prompt does not fit the head window, so it is missing rather than read in full.
    expect(first.sessions[0]?.firstPrompt).toBeNull();
    expect((await index.list(input)).stats.filesRead).toBe(0);

    await writeFile(file, header("s1", project) + userMessage("short"));
    const later = new Date(Date.now() + 5_000);
    await utimes(file, later, later);
    const changed = await index.list(input);
    expect(changed.stats.filesRead).toBe(1);
    expect(changed.sessions[0]?.firstPrompt).toBe("short");
  });
});
