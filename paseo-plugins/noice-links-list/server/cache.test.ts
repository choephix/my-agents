import { appendFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TailFold } from "./cache";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mentioned-links-"));
  file = path.join(dir, "session.jsonl");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** Records every line it is handed, so a test sees exactly which bytes were read. */
const lines = () => new TailFold<string[]>(() => [], 8);
const collect = (acc: string[], line: string) => void acc.push(line);

describe("TailFold", () => {
  it("folds only the lines appended since the last read and waits for a line's newline", async () => {
    const fold = lines();
    await writeFile(file, '{"a":1}\n{"b":2}\n{"c":');
    expect(await fold.read(file, collect)).toEqual(['{"a":1}', '{"b":2}']);
    await appendFile(file, '3}\n{"d":4}\n');
    expect(await fold.read(file, collect)).toEqual(['{"a":1}', '{"b":2}', '{"c":3}', '{"d":4}']);
    expect(await fold.read(file, collect)).toEqual(['{"a":1}', '{"b":2}', '{"c":3}', '{"d":4}']);
  });

  it("joins a line longer than one chunk, multi-byte characters included", async () => {
    const long = `{"text":"${"ä".repeat(20)}"}`;
    await writeFile(file, `${long}\n{"x":1}\n`);
    expect(await lines().read(file, collect)).toEqual([long, '{"x":1}']);
  });

  it("starts over when the file shrinks or is replaced", async () => {
    const fold = lines();
    await writeFile(file, '{"old":1}\n{"old":2}\n');
    await fold.read(file, collect);
    await writeFile(file, '{"new":1}\n');
    expect(await fold.read(file, collect)).toEqual(['{"new":1}']);
    // Replaced by a longer file (another inode), as a rename-over write does.
    const replacement = path.join(dir, "next.jsonl");
    await writeFile(replacement, '{"newer":1}\n{"newer":2}\n');
    await rename(replacement, file);
    expect(await fold.read(file, collect)).toEqual(['{"newer":1}', '{"newer":2}']);
  });

  it("serializes concurrent reads of one file", async () => {
    const fold = lines();
    await writeFile(file, '{"a":1}\n{"b":2}\n');
    const [first, second] = await Promise.all([fold.read(file, collect), fold.read(file, collect)]);
    expect(first).toBe(second);
    expect(first).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("rejects a missing file", async () => {
    await expect(lines().read(path.join(dir, "gone.jsonl"), collect)).rejects.toThrow(/ENOENT/);
  });
});
