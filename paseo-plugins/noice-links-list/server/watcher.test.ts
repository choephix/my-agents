import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TranscriptWatcher } from "./watcher";

const temps: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "noice-links-watcher-"));
  temps.push(dir);
  return dir;
}

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("Timed out waiting for watcher"));
      setTimeout(tick, 15);
    };
    tick();
  });
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("TranscriptWatcher", () => {
  it("watches transcript files, coalesces bursts, and releases handles on close", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "session.jsonl");
    await writeFile(file, '{"line":1}\n');

    let hits = 0;
    const watcher = new TranscriptWatcher(() => hits++, 40);
    expect(watcher.watcherCount).toBe(0);

    watcher.setTargets({ files: new Set([file]), dirs: new Set() });
    expect(watcher.watcherCount).toBe(1);

    await appendFile(file, '{"line":2}\n');
    await appendFile(file, '{"line":3}\n');
    await waitFor(() => hits >= 1);
    expect(hits).toBe(1);

    watcher.close();
    expect(watcher.watcherCount).toBe(0);
  });

  it("watches sub-agent directories and newly created nested sub-agent files", async () => {
    const dir = await makeTempDir();
    const subDir = path.join(dir, "session");
    await mkdir(subDir);

    let hits = 0;
    const watcher = new TranscriptWatcher(() => hits++, 40);
    watcher.setTargets({ files: new Set(), dirs: new Set([subDir]) });
    expect(watcher.watcherCount).toBe(1);

    await writeFile(path.join(subDir, "Scout.jsonl"), '{"line":1}\n');
    await waitFor(() => hits >= 1);

    // Removing targets closes unused watchers immediately.
    watcher.setTargets({ files: new Set(), dirs: new Set() });
    expect(watcher.watcherCount).toBe(0);
    watcher.close();
  });
});
