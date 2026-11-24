import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBoxFolder } from "./config";
import { parseSlipMarkdown } from "./frontmatter";
import { SlipIndex } from "./index";
import { searchSlips } from "./search";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeFixture(filePath: string, content: string, mtimeSec?: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  if (mtimeSec !== undefined) {
    const time = new Date(mtimeSec * 1000);
    await utimes(filePath, time, time);
  }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("resolveBoxFolder", () => {
  it("resolves setting, env, desk config, and md-embed in priority order", async () => {
    const home = await makeTempDir("slipbox-home-");
    await writeFixture(
      path.join(home, ".config", "slipbox-desk", "settings.json"),
      JSON.stringify({ boxes: [{ path: "~/desk-box" }] }),
    );
    await writeFixture(
      path.join(home, ".omp", "agent", "md-embed.json"),
      JSON.stringify({ vaultFolder: "~/embed-box" }),
    );

    expect(await resolveBoxFolder("~/custom-box", { home, env: { SLIPBOX_DIR: "~/env-box" } })).toEqual({
      folder: path.join(home, "custom-box"),
      source: "setting",
    });

    expect(await resolveBoxFolder("", { home, env: { SLIPBOX_DIR: "~/env-box" } })).toEqual({
      folder: path.join(home, "env-box"),
      source: "env",
    });

    expect(await resolveBoxFolder("", { home, env: {} })).toEqual({
      folder: path.join(home, "desk-box"),
      source: "desk-config",
    });

    await rm(path.join(home, ".config", "slipbox-desk", "settings.json"));
    expect(await resolveBoxFolder("", { home, env: {} })).toEqual({
      folder: path.join(home, "embed-box"),
      source: "md-embed",
    });

    await rm(path.join(home, ".omp", "agent", "md-embed.json"));
    expect(await resolveBoxFolder("", { home, env: {} })).toEqual({
      folder: null,
      source: "none",
    });
  });

  it("rejects non-absolute setting paths without falling back", async () => {
    const home = await makeTempDir("slipbox-rel-");
    expect(await resolveBoxFolder("relative/box", { home, env: { SLIPBOX_DIR: "/tmp/other" } })).toEqual({
      folder: null,
      source: "setting",
    });
  });
});

describe("parseSlipMarkdown", () => {
  it("extracts front matter, title, and plain-text summary", () => {
    const parsed = parseSlipMarkdown(
      [
        "---",
        "kind: proposal # waiting for approval",
        'emoji: "📲"',
        "about: ~/workspace/demo",
        "settled: 2026-11-24",
        "---",
        "",
        "# Make `demo` a **PWA**",
        "",
        "![[diagram.svg]]",
        "First sentence with [[2026-11-24-link|a linked note]] and [docs](https://example.com).",
        "",
        "More body text.",
      ].join("\n"),
      "2026-11-24-demo",
    );

    expect(parsed.frontMatter).toEqual({
      kind: "proposal",
      emoji: "📲",
      about: "~/workspace/demo",
      settled: "2026-11-24",
    });
    expect(parsed.title).toBe("Make demo a PWA");
    expect(parsed.summary).toBe("First sentence with a linked note and docs.");
  });
});

describe("SlipIndex and searchSlips", () => {
  it("indexes a structured slip-box, ranks open memos first, and validates against SDK schema", async () => {
    const box = await makeTempDir("slipbox-vault-");
    await writeFixture(path.join(box, "AGENTS.md"), "# Box rules\nIgnored at root.");
    await writeFixture(path.join(box, "mocks", "2026-11-20-mock.md"), "# Mock\nIgnored.");
    await writeFixture(path.join(box, ".revisions", "2026-11-20-old.md"), "# Revision\nIgnored.");
    await writeFixture(
      path.join(box, "memos", "2026-11-24-open-ask.md"),
      [
        "---",
        "kind: ask",
        "emoji: 🔑",
        "about: ~/workspace/my-app",
        "---",
        "",
        "# Staging credentials",
        "",
        "Pick which staging token should rotate first.",
        "",
        "Deep details mention zebra-token-rotation inside the body.",
      ].join("\n"),
      1_700_000_200,
    );
    await writeFixture(
      path.join(box, "memos", "2026-11-23-settled-read.md"),
      [
        "---",
        "kind: read",
        "emoji: 🧩",
        "settled: 2026-11-23",
        "settled_as: saved",
        "---",
        "",
        "# Plugin API survey",
        "",
        "Summary of new SDK hooks.",
      ].join("\n"),
      1_700_000_300,
    );
    await writeFixture(
      path.join(box, "captures", "2026-11-24-chat capture.md"),
      "---\nkind: capture\n---\n\n# Raw paste\n\nWord for word capture.",
      1_700_000_400,
    );
    await writeFixture(
      path.join(box, "efforts", "pwa", "map.md"),
      "# PWA Effort Map\n\nTrack PWA research milestones.",
      1_700_000_100,
    );

    const index = new SlipIndex();
    const all = await index.list(box, {
      includeCaptures: true,
      includeAgentNotes: true,
      includeSettled: true,
    });
    expect(all.map((s) => s.relativePath).sort()).toEqual([
      "captures/2026-11-24-chat capture.md",
      "efforts/pwa/map.md",
      "memos/2026-11-23-settled-read.md",
      "memos/2026-11-24-open-ask.md",
    ]);

    // Empty query puts open memos first, then other open slips, then settled slips.
    const emptyPayload = PluginAttachmentSearchPayloadSchema.parse(searchSlips(all, ""));
    expect(emptyPayload.items.map((item) => item.id)).toEqual([
      "memos/2026-11-24-open-ask.md",
      "captures/2026-11-24-chat capture.md",
      "efforts/pwa/map.md",
      "memos/2026-11-23-settled-read.md",
    ]);
    expect(emptyPayload.items[0]).toMatchObject({
      identifier: "🔑 [ask]",
      title: "Staging credentials",
      resourceType: "ask",
    });
    expect(emptyPayload.items[0].text).toContain("Wiki link: [[2026-11-24-open-ask]]");
    expect(emptyPayload.items[2].text).toContain("Wiki link: [[efforts/pwa/map]]");
    expect(emptyPayload.items[1].url).toContain("2026-11-24-chat%20capture.md");

    // Body-only matches include the matching snippet in subtitle so Combobox keeps them visible.
    const bodyMatch = PluginAttachmentSearchPayloadSchema.parse(searchSlips(all, "zebra-token-rotation"));
    expect(bodyMatch.items).toHaveLength(1);
    expect(bodyMatch.items[0].id).toBe("memos/2026-11-24-open-ask.md");
    expect(bodyMatch.items[0].subtitle?.toLowerCase()).toContain("zebra-token-rotation");

    // Folder & settled filters work cleanly.
    const openMemosOnly = await index.list(box, {
      includeCaptures: false,
      includeAgentNotes: false,
      includeSettled: false,
    });
    expect(openMemosOnly.map((s) => s.relativePath)).toEqual(["memos/2026-11-24-open-ask.md"]);
  });

  it("works portably on a plain Markdown notes folder without a memos/ directory", async () => {
    const notes = await makeTempDir("slipbox-plain-");
    await writeFixture(path.join(notes, "ideas.md"), "# Weekend ideas\n\nBuild a portable plugin.");
    await writeFixture(path.join(notes, "sub", "arch.md"), "# Architecture\n\nNotes on modules.");
    await writeFixture(path.join(notes, ".hidden", "secret.md"), "# Hidden\n\nSkip me.");

    const index = new SlipIndex();
    const records = await index.list(notes, {
      includeCaptures: true,
      includeAgentNotes: true,
      includeSettled: true,
    });
    expect(records.map((r) => r.relativePath).sort()).toEqual(["ideas.md", "sub/arch.md"]);
    const found = searchSlips(records, "portable");
    expect(found.items.map((i) => i.id)).toEqual(["ideas.md"]);
  });

  it("refreshes cached slips when a file changes and truncates oversized snapshots cleanly", async () => {
    const box = await makeTempDir("slipbox-cache-");
    const memoPath = path.join(box, "memos", "2026-11-24-live.md");
    await writeFixture(memoPath, "# Initial title\n\nShort body.", 1_700_000_000);

    const index = new SlipIndex();
    const first = await index.list(box, { includeCaptures: true, includeAgentNotes: true, includeSettled: true });
    expect(first[0].title).toBe("Initial title");

    const hugeBody = "x".repeat(40 * 1024);
    await writeFixture(memoPath, `# Updated title\n\n${hugeBody}`, 1_700_000_010);
    const second = await index.list(box, { includeCaptures: true, includeAgentNotes: true, includeSettled: true });
    expect(second[0].title).toBe("Updated title");

    const payload = searchSlips(second, "Updated");
    expect(payload.items[0].text).toContain("[Truncated at 32768 chars.");
    expect(payload.items[0].text).toContain(memoPath);
  });
});
