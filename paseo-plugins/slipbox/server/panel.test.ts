import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractWikiReferences,
  parseSlipCommandInput,
  segmentSlipBody,
  setSlipSettled,
  slugifySlipTitle,
} from "../shared/frontmatter";
import { createSlipFile } from "./create";
import { SlipIndex } from "./index";
import { resolveSlipContext } from "./resolve";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeFixture(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("setSlipSettled", () => {
  it("settles, saves, and reopens while preserving comments, order, and body", () => {
    const original = [
      "---",
      "kind: ask",
      "emoji: 🔑",
      "# keep this comment",
      "about: ~/workspace/demo",
      "---",
      "",
      "# Pick a token",
      "",
      "Body text.",
      "",
    ].join("\n");

    const settled = setSlipSettled(original, { mode: "settle", date: "2026-11-24", by: "user via paseo" });
    expect(settled).toContain("settled: 2026-11-24\nsettled_by: user via paseo\n---");
    expect(settled).toContain("# keep this comment");
    expect(settled).not.toContain("settled_as:");
    expect(settled.endsWith("# Pick a token\n\nBody text.\n")).toBe(true);

    const saved = setSlipSettled(settled, { mode: "save", date: "2026-11-25", by: "user via paseo" });
    expect(saved).toContain("settled: 2026-11-25\nsettled_by: user via paseo\nsettled_as: saved\n---");

    const reopened = setSlipSettled(saved, { mode: "reopen" });
    expect(reopened).toBe(original);
  });

  it("creates front matter when settling a plain Markdown note and preserves CRLF", () => {
    const plain = "# Plain note\r\n\r\nDetails.\r\n";
    expect(setSlipSettled(plain, { mode: "reopen" })).toBe(plain);

    const settled = setSlipSettled(plain, { mode: "save", date: "2026-11-24", by: "user via paseo" });
    expect(settled).toBe(
      "---\r\nsettled: 2026-11-24\r\nsettled_by: user via paseo\r\nsettled_as: saved\r\n---\r\n\r\n# Plain note\r\n\r\nDetails.\r\n",
    );
  });
});

describe("wiki link extraction and body segmentation", () => {
  it("ignores code blocks and inline code, rewrites links/images, and extracts standalone slip embeds", () => {
    const md = [
      "See [[2026-11-24-alpha]] and [[2026-11-24-capture#L10-L20|lines]] and `[[ignored-inline]]`.",
      "",
      "![[2026-11-24-alpha]]",
      "",
      "![[shot.png]]",
      "",
      "```md",
      "[[ignored-fence]]",
      "![[ignored-embed]]",
      "```",
      "",
      "Keep [[unresolved-note]] as plain text.",
    ].join("\n");

    const refs = extractWikiReferences(md);
    expect(refs.linkTargets.sort()).toEqual([
      "2026-11-24-alpha",
      "2026-11-24-capture",
      "shot.png",
      "unresolved-note",
    ]);
    expect(refs.embedRequests).toEqual([
      { target: "2026-11-24-alpha", fragment: "" },
      { target: "shot.png", fragment: "" },
    ]);

    const segments = segmentSlipBody(
      md,
      {
        "2026-11-24-alpha": {
          path: "/box/memos/2026-11-24-alpha.md",
          relativePath: "memos/2026-11-24-alpha.md",
          wikiName: "2026-11-24-alpha",
          isImage: false,
          isMarkdown: true,
          title: "Alpha",
          emoji: "🚀",
          kind: "read",
        },
        "2026-11-24-capture": {
          path: "/box/captures/2026-11-24-capture.md",
          relativePath: "captures/2026-11-24-capture.md",
          wikiName: "2026-11-24-capture",
          isImage: false,
          isMarkdown: true,
          title: "Capture",
          kind: "capture",
        },
        "shot.png": {
          path: "/box/attachments/shot.png",
          relativePath: "attachments/shot.png",
          wikiName: "shot.png",
          isImage: true,
          isMarkdown: false,
        },
      },
      { "2026-11-24-alpha#": "Embedded body." },
    );

    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({
      kind: "markdown",
      text: "See [🚀 Alpha](<file:///box/memos/2026-11-24-alpha.md>) and [lines](<file:///box/captures/2026-11-24-capture.md#L10-L20>) and `[[ignored-inline]]`.\n",
    });
    expect(segments[1]).toMatchObject({
      kind: "embed",
      target: "2026-11-24-alpha",
      label: "🚀 Alpha",
      resolved: { previewMarkdown: "Embedded body." },
    });
    expect(segments[2]).toEqual({
      kind: "markdown",
      text: "\n![shot.png](<file:///box/attachments/shot.png>)\n\n```md\n[[ignored-fence]]\n![[ignored-embed]]\n```\n\nKeep [[unresolved-note]] as plain text.",
    });
  });
});

describe("parseSlipCommandInput and slugifySlipTitle", () => {
  it("parses kind prefixes, multiline notes, and long single-line inputs", () => {
    expect(parseSlipCommandInput("   ")).toBeNull();
    expect(parseSlipCommandInput("Check retry timeout")).toEqual({
      kind: "note",
      title: "Check retry timeout",
      body: "",
    });
    expect(parseSlipCommandInput("ask: Use SQLite or JSON?\nCompare bundle size and locking.")).toEqual({
      kind: "ask",
      title: "Use SQLite or JSON?",
      body: "Compare bundle size and locking.",
    });
    expect(parseSlipCommandInput("unknown: Keep full title")).toEqual({
      kind: "note",
      title: "unknown: Keep full title",
      body: "",
    });
    expect(slugifySlipTitle("Café: Make `demo` a PWA?")).toBe("cafe-make-demo-a-pwa");
  });
});

describe("resolveSlipContext", () => {
  it("resolves targets, section/line embeds, attachments, backlinks, and prevents self-embed loops", async () => {
    const box = await makeTempDir("slipbox-resolve-");
    const mainPath = path.join(box, "memos", "2026-11-24-main.md");
    const childPath = path.join(box, "memos", "2026-11-24-child.md");
    const backlinkPath = path.join(box, "memos", "2026-11-24-referencer.md");
    const imagePath = path.join(box, "attachments", "diagram.png");

    await writeFixture(
      mainPath,
      "---\nkind: read\n---\n\n# Main\n\nSee [[2026-11-24-child]] and ![[2026-11-24-child#Details]] and ![[diagram.png]].\n",
    );
    await writeFixture(
      childPath,
      [
        "---",
        "kind: note",
        "emoji: 📌",
        "---",
        "",
        "# Child note",
        "",
        "Intro line.",
        "",
        "## Details",
        "",
        "Section pointing back to [[2026-11-24-main]].",
        "",
        "## Next",
        "",
        "Other section.",
      ].join("\n"),
    );
    await writeFixture(
      backlinkPath,
      "---\nkind: proposal\nemoji: 🧭\n---\n\n# Referencer\n\nBuilds on [[2026-11-24-main|the main memo]].\n",
    );
    await writeFixture(imagePath, "fake-png");

    const index = new SlipIndex();
    const ctx = await resolveSlipContext({
      boxFolder: box,
      filePath: mainPath,
      targets: ["2026-11-24-child", "diagram.png", "../secret", "2026-11-24-main"],
      embedRequests: [
        { target: "2026-11-24-child", fragment: "Details" },
        { target: "2026-11-24-main", fragment: "" },
      ],
      includeBacklinks: true,
      index,
    });

    expect(ctx.inBox).toBe(true);
    expect(ctx.folder).toBe("memos");
    expect(ctx.wikiName).toBe("2026-11-24-main");
    expect(ctx.resolved["../secret"]).toBeUndefined();
    expect(ctx.resolved["diagram.png"]).toMatchObject({
      path: imagePath,
      isImage: true,
      isMarkdown: false,
    });
    expect(ctx.embedPreviews["2026-11-24-child#Details"]).toContain(
      `[Main](<file://${encodeURI(mainPath)}>)`,
    );
    expect(ctx.embedPreviews["2026-11-24-child#Details"]).not.toContain("Other section.");
    expect(ctx.embedPreviews["2026-11-24-main#"]).toBe("*Already open above.*");
    expect(ctx.backlinks.map((b) => b.wikiName)).toEqual([
      "2026-11-24-child",
      "2026-11-24-referencer",
    ]);
  });
});

describe("createSlipFile", () => {
  it("creates dated memos and captures with unique collision suffixes and ~/ about contraction", async () => {
    const box = await makeTempDir("slipbox-create-");
    await mkdir(path.join(box, "memos"), { recursive: true });
    const fakeHome = "/home/example";
    const date = new Date(2026, 10, 24, 14, 0, 0);

    const first = await createSlipFile({
      boxFolder: box,
      title: "Check retry timeout",
      body: "Verify backoff on mobile.",
      kind: "ask",
      emoji: "⏱️",
      about: "/home/example/workspace/app",
      from: "session:abc-123",
      date,
      home: fakeHome,
    });

    expect(first.relativePath).toBe("memos/2026-11-24-check-retry-timeout.md");
    expect(first.wikiName).toBe("2026-11-24-check-retry-timeout");
    const firstContent = await readFile(first.absolutePath, "utf8");
    expect(firstContent).toContain("kind: ask\nemoji: ⏱️\nabout: ~/workspace/app\nfrom: \"session:abc-123\"");
    expect(firstContent).toContain("# Check retry timeout\n\nVerify backoff on mobile.\n");

    // Creating a second slip with the same title appends -2 instead of overwriting.
    const second = await createSlipFile({
      boxFolder: box,
      title: "Check retry timeout",
      date,
      home: fakeHome,
    });
    expect(second.relativePath).toBe("memos/2026-11-24-check-retry-timeout-2.md");

    // Captures go into captures/ in a structured box.
    const capture = await createSlipFile({
      boxFolder: box,
      title: "Raw transcript",
      kind: "capture",
      body: "Verbatim text.",
      date,
      home: fakeHome,
    });
    expect(capture.relativePath).toBe("captures/2026-11-24-raw-transcript.md");
  });
});
