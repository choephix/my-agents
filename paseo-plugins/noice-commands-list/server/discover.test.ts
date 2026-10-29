import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverCommands } from "./discover";

const OFF = { claude: false, cursor: false, omp: false, codex: false };
let root: string;
let home: string;
let repo: string;

async function put(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "agent-commands-"));
  home = path.join(root, "home");
  repo = path.join(root, "repo");
  await mkdir(path.join(repo, ".git"), { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("discoverCommands", () => {
  it("lets a project command hide the user one of the same name, nearest folder first", async () => {
    await put(path.join(home, ".agents/commands/commit.md"), "user commit");
    await put(path.join(home, ".agents/commands/explain.md"), "user explain");
    await put(path.join(repo, ".agents/commands/commit.md"), "repo commit");
    await put(path.join(repo, ".agents/commands/review.md"), "repo review");
    await put(path.join(repo, "pkg/.agents/commands/review.md"), "pkg review");
    const found = await discoverCommands(path.join(repo, "pkg"), OFF, home);
    expect(found.map((c) => [c.name, c.scope, c.body])).toEqual([
      ["commit", "project", "repo commit"],
      ["explain", "user", "user explain"],
      ["review", "project", "pkg review"],
    ]);
  });

  it("reads extra folders only when switched on, after every .agents folder", async () => {
    await put(path.join(home, ".agents/commands/review.md"), "user review");
    await put(path.join(repo, ".claude/commands/review.md"), "claude review");
    await put(path.join(repo, ".claude/commands/pr-summary.md"), "claude summary");
    await put(path.join(home, ".codex/prompts/draft.md"), "codex draft");
    expect((await discoverCommands(repo, OFF, home)).map((c) => c.name)).toEqual(["review"]);
    const found = await discoverCommands(repo, { ...OFF, claude: true, codex: true }, home);
    expect(found.map((c) => [c.name, c.source, c.body])).toEqual([
      ["draft", "codex", "codex draft"],
      ["pr-summary", "claude", "claude summary"],
      ["review", "agents", "user review"],
    ]);
  });

  it("stops at the cwd without a git root and ignores subfolders and non-.md files", async () => {
    const loose = path.join(root, "loose/inner");
    await put(path.join(root, "loose/.agents/commands/outside.md"), "x");
    await put(path.join(loose, ".agents/commands/inside.md"), "x");
    await put(path.join(loose, ".agents/commands/notes.txt"), "x");
    await put(path.join(loose, ".agents/commands/sub/deep.md"), "x");
    expect((await discoverCommands(loose, OFF, home)).map((c) => c.name)).toEqual(["inside"]);
  });
});
