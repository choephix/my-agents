import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { PastSession } from "../shared/rpc";

/** The plugin's host-side data folder: stars, hidden rows and memos. */
export function dataDir(): string {
  return path.join(process.env.PASEO_HOME ?? path.join(homedir(), ".paseo"), "plugin-data", "past-sessions");
}

const MemoFile = z.object({
  version: z.literal(1),
  memos: z.record(z.string(), z.object({ memo: z.string(), attention: z.string().optional(), at: z.string() })),
});

/** What a row shows: the memo, and what needs Stefan (loose ends, open questions), if anything. */
export interface Memo {
  memo: string;
  attention?: string;
}

const OMP_SESSION_FILE = /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/**
 * Memo keys a row answers to, most specific first: its list key, then `omp:<sessionId>` of its
 * OMP transcript. The second one survives importing a terminal session as an agent, because the
 * agent keeps reading the same session file.
 */
export function memoKeys(entry: Pick<PastSession, "key" | "file">): string[] {
  const keys = [entry.key];
  const match = entry.file?.match(OMP_SESSION_FILE);
  if (match && `omp:${match[1]}` !== entry.key) keys.push(`omp:${match[1]}`);
  return keys;
}

/**
 * `memos.json`: short notes agents leave on a session ("what's left, why reopen it"), written by
 * `bin/memo.mjs`. The daemon side only reads it, again whenever its mtime changes.
 */
export class MemoReader {
  private cached: { mtimeMs: number; memos: Map<string, Memo> } | null = null;

  constructor(private readonly file: string) {}

  async load(): Promise<Map<string, Memo>> {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(this.file)).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
      throw error;
    }
    if (this.cached?.mtimeMs === mtimeMs) return this.cached.memos;
    const parsed = MemoFile.parse(JSON.parse(await readFile(this.file, "utf8")));
    const memos = new Map(
      Object.entries(parsed.memos).map(([key, { memo, attention }]): [string, Memo] => [
        key,
        attention ? { memo, attention } : { memo },
      ]),
    );
    this.cached = { mtimeMs, memos };
    return memos;
  }
}

export const memoReader = new MemoReader(path.join(dataDir(), "memos.json"));
