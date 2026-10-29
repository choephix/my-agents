import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { sections } from "../shared/parse";
import { MAX_COMMITS } from "../shared/settings";
import { Lru } from "./lru";
import { readText } from "./scan";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], { timeout: 8_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

/** Counts below are for Stefan's folders on 2026-10-21: 69 efforts in 3 `.scratch` folders. */
const tops = new Lru<string, { at: number; top: Promise<string | null> }>(500);
/** "Not in a repo" is re-checked after a minute, so a later `git init` shows up; a found top is kept. */
const NO_REPO_MS = 60_000;

/** Top folder of the git repo that owns a real path, null when it isn't in one. */
export function repoTop(dir: string): Promise<string | null> {
  const cached = tops.get(dir);
  if (!cached) return lookUpTop(dir);
  return cached.top.then((top) => (top || Date.now() - cached.at < NO_REPO_MS ? top : lookUpTop(dir)));
}

function lookUpTop(dir: string): Promise<string | null> {
  const top = git(dir, ["rev-parse", "--show-toplevel"]).then(
    (out) => out.trim() || null,
    () => null,
  );
  tops.set(dir, { at: Date.now(), top });
  return top;
}

export interface Change {
  /** Path relative to the effort folder. */
  rel: string;
  kind: "new" | "modified" | "deleted";
  /**
   * Changes whenever this file's diff against HEAD can change: its `git status` v2 record (which
   * carries the HEAD and index blob hashes) plus the worktree file's mtime and size.
   */
  sig: string;
}

interface StatusEntry {
  kind: Change["kind"];
  record: string;
}

/** One per `.scratch` folder: 3 today. */
const statusCache = new Lru<string, { at: number; result: Promise<Map<string, StatusEntry>> }>(50);

/** Where the path starts in a v2 record that has `fields` space-separated fields before it. */
function pathStart(record: string, fields: number): number {
  let at = -1;
  for (let field = 0; field < fields; field++) {
    at = record.indexOf(" ", at + 1);
    if (at === -1) return record.length;
  }
  return at + 1;
}

/**
 * `git status` for one `.scratch` folder, at most every 2 s per folder: absolute path → change.
 * Untracked folders are listed file by file.
 */
function scratchStatus(top: string, root: string): Promise<Map<string, StatusEntry>> {
  const cached = statusCache.get(root);
  if (cached && Date.now() - cached.at < 2_000) return cached.result;
  const result = git(top, ["status", "--porcelain=v2", "-z", "-uall", "--", path.relative(top, root) || "."]).then(
    (out) => {
      const changes = new Map<string, StatusEntry>();
      const records = out.split("\0");
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        // `1 XY sub mH mI mW hH hI path`; `2 XY … hI Xscore path`, then the old path as the next
        // record; `u XY sub m1 m2 m3 mW h1 h2 h3 path`; `? path`. XY uses `.` for "unchanged".
        const type = record[0];
        let code: string;
        let file: string;
        if (type === "?") {
          code = "??";
          file = record.slice(2);
        } else if (type === "1" || type === "2" || type === "u") {
          code = record.slice(2, 4).replace(/\./g, " ");
          file = record.slice(pathStart(record, type === "1" ? 8 : type === "2" ? 9 : 10));
          if (type === "2") index++;
        } else continue;
        if (!file) continue;
        changes.set(path.join(top, file), {
          kind: code === "??" || code.includes("A") ? "new" : code.includes("D") ? "deleted" : "modified",
          record,
        });
      }
      return changes;
    },
    () => new Map<string, StatusEntry>(),
  );
  statusCache.set(root, { at: Date.now(), result });
  return result;
}

export async function effortChanges(effortDir: string, root: string): Promise<{ top: string; changes: Change[] } | null> {
  const top = await repoTop(effortDir);
  if (!top) return null;
  const all = await scratchStatus(top, root);
  const prefix = effortDir + path.sep;
  const changes: Change[] = [];
  for (const [file, { kind, record }] of all) {
    if (!file.startsWith(prefix)) continue;
    const info = kind === "deleted" ? undefined : statSync(file, { throwIfNoEntry: false });
    changes.push({ rel: file.slice(prefix.length), kind, sig: `${record}\0${info ? `${info.mtimeMs}:${info.size}` : "-"}` });
  }
  changes.sort((a, b) => a.rel.localeCompare(b.rel));
  return { top, changes };
}

type LineCounts = Map<string, { added: number; removed: number }>;
const numstatCache = new Lru<string, { key: string; result: Promise<LineCounts> }>(500);

/**
 * Added/removed line counts of tracked changes under the effort, by path relative to it. Reused
 * while the effort's change signatures stay the same: the diff against HEAD can't differ then.
 */
export function numstat(top: string, effortDir: string, changes: readonly Change[]): Promise<LineCounts> {
  const key = `${top}\n${changes.map((change) => change.sig).join("\n")}`;
  const cached = numstatCache.get(effortDir);
  if (cached?.key === key) return cached.result;
  const result = git(top, ["diff", "--numstat", "HEAD", "--", path.relative(top, effortDir)]).then(
    (text) => {
      const out: LineCounts = new Map();
      for (const line of text.split("\n")) {
        const [added, removed, file] = line.split("\t");
        if (!file) continue;
        out.set(path.relative(effortDir, path.join(top, file)), { added: Number(added) || 0, removed: Number(removed) || 0 });
      }
      return out;
    },
    // Unborn HEAD or a broken repo: no line counts, and the next poll asks git again.
    (): LineCounts => {
      numstatCache.delete(effortDir);
      return new Map();
    },
  );
  numstatCache.set(effortDir, { key, result });
  return result;
}

export interface SectionChanges {
  /** Added lines per `## ` section, in file order: `[["Decisions so far", 8], ["Notes", 3]]`. */
  sections: [string, number][];
}

/** One per changed Markdown file seen in a detail. */
const sectionCache = new Lru<string, { sig: string; result: Promise<SectionChanges> }>(200);

/**
 * Where a changed Markdown file gained lines since the last commit. `sig` is the file's
 * `Change.sig`; the result is reused while it stays the same.
 */
export function sectionChanges(top: string, file: string, sig: string): Promise<SectionChanges> {
  const cached = sectionCache.get(file);
  if (cached?.sig === sig) return cached.result;
  const result = sectionChangesNow(top, file).then((changes) => {
    if (!changes) {
      sectionCache.delete(file);
      return { sections: [] };
    }
    if (sectionCache.get(file)?.result === result) sectionCache.set(file, { sig, result });
    return changes;
  });
  sectionCache.set(file, { sig, result });
  return result;
}

/** Null when git or the file can't be read; that result isn't cached. */
async function sectionChangesNow(top: string, file: string): Promise<SectionChanges | null> {
  let diff: string;
  let text: string;
  try {
    [diff, { text }] = await Promise.all([git(top, ["diff", "-U0", "HEAD", "--", path.relative(top, file)]), readText(file)]);
  } catch {
    return null;
  }
  const heads = sections(text);
  const counts = new Map<string, number>();
  for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]) - 1;
    const length = match[2] === undefined ? 1 : Number(match[2]);
    for (let line = start; line < start + length; line++) {
      let owner: (typeof heads)[number] | undefined;
      for (let index = heads.length - 1; index >= 0 && !owner; index--) if (heads[index].line <= line) owner = heads[index];
      const name = owner?.heading ?? "head";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return {
    sections: heads.filter((section) => counts.has(section.heading)).map((section) => [section.heading, counts.get(section.heading)!]),
  };
}

const logCache = new Lru<string, { at: number; result: Promise<{ hash: string; atMs: number; subject: string }[]> }>(500);

/** Newest commits touching the effort (one more than `MAX_COMMITS`, to tell there are more), cached for 20 s. */
export function commits(top: string, effortDir: string): Promise<{ hash: string; atMs: number; subject: string }[]> {
  const cached = logCache.get(effortDir);
  if (cached && Date.now() - cached.at < 20_000) return cached.result;
  const result = git(top, ["log", "-n", String(MAX_COMMITS + 1), "--format=%h%x1f%ct%x1f%s", "--", path.relative(top, effortDir)]).then(
    (out) =>
      out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, at, subject] = line.split("\x1f");
          return { hash, atMs: Number(at) * 1000, subject: subject ?? "" };
        }),
    () => [],
  );
  logCache.set(effortDir, { at: Date.now(), result });
  return result;
}
