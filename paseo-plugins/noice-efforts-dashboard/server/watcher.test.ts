import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commits, effortChanges } from "./git";
import { EffortsWatcher } from "./watcher";

const dirs: string[] = [];
const watchers: EffortsWatcher[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "efforts-watcher-test-"));
  dirs.push(dir);
  return dir;
}

function makeWatcher(options: ConstructorParameters<typeof EffortsWatcher>[0] = {}): EffortsWatcher {
  const watcher = new EffortsWatcher({ debounceMs: 30, gitDebounceMs: 40, ...options });
  watchers.push(watcher);
  return watcher;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for watcher notification");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

afterEach(async () => {
  while (watchers.length) watchers.pop()!.close();
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe("EffortsWatcher", () => {
  it("holds zero FSWatchers while idle and closes all watchers when the last subscriber disconnects", async () => {
    const base = await tempDir();
    const root = path.join(base, ".scratch");
    await mkdir(path.join(root, "alpha", "issues"), { recursive: true });

    const watcher = makeWatcher();
    watcher.setRoots([root]);
    expect(watcher.watcherCount).toBe(0);

    const offA = watcher.onOverview(() => {});
    expect(watcher.watcherCount).toBe(3); // root, alpha, alpha/issues

    const offB = watcher.onOverview(() => {});
    expect(watcher.watcherCount).toBe(3);

    offA();
    expect(watcher.watcherCount).toBe(3);

    offB();
    expect(watcher.watcherCount).toBe(0);
  });

  it("notifies overview and detail subscribers on ticket edits and dynamically watches new efforts and subfolders", async () => {
    const base = await tempDir();
    const root = path.join(base, ".scratch");
    await mkdir(path.join(root, "alpha", "issues"), { recursive: true });
    await writeFile(path.join(root, "alpha", "map.md"), "# Alpha\n");

    const watcher = makeWatcher();
    watcher.setRoots([root]);

    let overviewHits = 0;
    let detailHits = 0;
    const offOverview = watcher.onOverview(() => overviewHits++);
    const offDetail = watcher.onDetail(root, "alpha", () => detailHits++);

    // Ticket edit inside issues/ notifies both overview and detail.
    await writeFile(path.join(root, "alpha", "issues", "01-task.md"), "# 01 Task\nStatus: done\n");
    await waitFor(() => overviewHits >= 1 && detailHits >= 1);

    // Temp/hidden files are ignored.
    const beforeOverview = overviewHits;
    const beforeDetail = detailHits;
    await writeFile(path.join(root, "alpha", ".hidden.tmp"), "ignore");
    await writeFile(path.join(root, "alpha", "issues", "01-task.md.tmp"), "ignore");
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(overviewHits).toBe(beforeOverview);
    expect(detailHits).toBe(beforeDetail);

    // Creating a new effort + issues/ dynamically attaches watchers and notifies.
    await mkdir(path.join(root, "beta", "issues"), { recursive: true });
    await waitFor(() => overviewHits > beforeOverview);
    const afterMkdir = overviewHits;
    await writeFile(path.join(root, "beta", "issues", "01-new.md"), "# 01 New\nStatus: open\n");
    await waitFor(() => overviewHits > afterMkdir);

    offDetail();
    offOverview();
    expect(watcher.watcherCount).toBe(0);
  });

  it("notifies detail subscribers and invalidates git caches on commits in the owning repo", async () => {
    const repo = await tempDir();
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
    const root = path.join(repo, ".scratch");
    const effortDir = path.join(root, "gamma");
    await mkdir(effortDir, { recursive: true });
    const mapFile = path.join(effortDir, "map.md");
    await writeFile(mapFile, "# Gamma\n");
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "initial commit");

    // Populate git status and commit log caches.
    await writeFile(mapFile, "# Gamma\n\nUpdated line\n");
    expect((await effortChanges(effortDir, root))?.changes.length).toBe(1);
    expect((await commits(repo, effortDir)).length).toBe(1);

    const watcher = makeWatcher();
    let detailHits = 0;
    const offDetail = watcher.onDetail(root, "gamma", () => detailHits++);
    // Wait for async gitDir/repoTop attachment.
    await waitFor(() => watcher.watcherCount >= 3);

    const beforeHits = detailHits;
    git("add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "second commit");
    await waitFor(() => detailHits > beforeHits);

    // Git caches were invalidated immediately (no waiting for 2 s status / 20 s log TTLs).
    expect((await effortChanges(effortDir, root))?.changes.length).toBe(0);
    expect((await commits(repo, effortDir)).length).toBe(2);

    offDetail();
    expect(watcher.watcherCount).toBe(0);
  });
});
