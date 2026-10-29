import { execFileSync } from "node:child_process";
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BindingStore } from "./bindings";
import { effortChanges, numstat, sectionChanges } from "./git";

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "efforts-test-"));
  dirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of dirs) {
    await chmod(dir, 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

const effort = (slug: string) => ({ kind: "effort" as const, root: "/r/.scratch", slug, at: "2026-10-20T00:00:00.000Z" });

describe("BindingStore", () => {
  it("keeps both of two binds made at once", async () => {
    const file = path.join(await tempDir(), "bindings.json");
    const store = new BindingStore(file);
    await Promise.all([store.set("wks_A", effort("a")), store.set("wks_B", effort("b"))]);
    expect(Object.keys(await store.all()).sort()).toEqual(["wks_A", "wks_B"]);
    expect(Object.keys(JSON.parse(await readFile(file, "utf8")).bindings).sort()).toEqual(["wks_A", "wks_B"]);
  });

  it("binds again after a failed write, and doesn't serve the binding that failed", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "data", "bindings.json");
    const store = new BindingStore(file);
    await store.set("wks_A", effort("a"));
    await chmod(path.dirname(file), 0o555);
    await expect(store.set("wks_C", effort("c"))).rejects.toThrow();
    expect(Object.keys(await store.all())).toEqual(["wks_A"]);
    await chmod(path.dirname(file), 0o755);
    await store.set("wks_D", effort("d"));
    expect(Object.keys(await store.all()).sort()).toEqual(["wks_A", "wks_D"]);
  });

  it("reads the file again after it was unreadable once", async () => {
    const file = path.join(await tempDir(), "bindings.json");
    await writeFile(file, "{ not json");
    const store = new BindingStore(file);
    await expect(store.all()).rejects.toThrow();
    await writeFile(file, JSON.stringify({ version: 1, bindings: { wks_A: effort("a") } }));
    expect(Object.keys(await store.all())).toEqual(["wks_A"]);
  });
});

describe("uncommitted line counts", () => {
  it("follow each edit of a changed file, also while `git status` is still cached", async () => {
    const repo = await tempDir();
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
    const dir = path.join(repo, ".scratch", "e1");
    await mkdir(dir, { recursive: true });
    const map = path.join(dir, "map.md");
    await writeFile(map, "# E1\n\n## Decisions so far\n\n- one\n");
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    const root = path.join(repo, ".scratch");
    const counts = async () => {
      const found = await effortChanges(dir, root);
      const change = found!.changes.find((candidate) => candidate.rel === "map.md")!;
      const [stats, sections] = await Promise.all([numstat(found!.top, dir, found!.changes), sectionChanges(found!.top, map, change.sig)]);
      return { added: stats.get("map.md")?.added, sections: sections.sections };
    };

    await appendFile(map, "- two\n");
    expect(await counts()).toEqual({ added: 1, sections: [["Decisions so far", 1]] });
    // Within the 2 s status cache: same status record, new mtime and size.
    await appendFile(map, "- three\n");
    expect(await counts()).toEqual({ added: 2, sections: [["Decisions so far", 2]] });
  });
});
