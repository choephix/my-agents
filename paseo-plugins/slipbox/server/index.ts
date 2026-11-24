import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SlipboxSettings } from "../shared/settings";
import { parseSlipMarkdown } from "./frontmatter";

/** Maximum file size read into the search index (2 MiB). */
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MARKDOWN_RE = /\.(md|markdown)$/i;
const IGNORED_DIRS = new Set(["node_modules", "mocks", "attachments"]);
const IGNORED_ROOT_FILES = new Set(["AGENTS.md", "CLAUDE.md"]);

export interface SlipRecord {
  /** Posix-normalized path relative to the slip-box root, e.g. `memos/2026-11-24-foo.md`. */
  relativePath: string;
  /** Resolved absolute path on disk. */
  absolutePath: string;
  /** Top-level folder (`memos`, `captures`, `scraps`, `efforts`, or `""` for root files). */
  folder: string;
  /** File basename without extension. */
  slug: string;
  /** Wiki-link target (`efforts/foo/map` for efforts; bare slug elsewhere). */
  wikiName: string;
  kind: string;
  emoji: string;
  title: string;
  summary: string;
  about: string;
  settled: string;
  settledAs: string;
  rawText: string;
  bodyText: string;
  mtimeMs: number;
  size: number;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  record: SlipRecord;
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function inferKind(relativePath: string, folder: string, fmKind: string | undefined): string {
  if (relativePath.startsWith("scraps/")) return "scrap";
  if (relativePath.startsWith("efforts/")) {
    if (relativePath === "efforts/TRACKER.md") return "rule";
    if (relativePath.endsWith("/map.md")) return "map";
    if (relativePath.includes("/issues/")) return "ticket";
    return "research";
  }
  if (fmKind) return fmKind.toLowerCase();
  if (folder === "captures") return "capture";
  return "note";
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function walkMarkdownFiles(
  root: string,
  subDir: string,
  skipRootDocs: boolean,
  found: Map<string, { absolutePath: string; mtimeMs: number; size: number }>,
): Promise<void> {
  const startDir = subDir ? path.join(root, subDir) : root;
  const stack: Array<{ abs: string; rel: string }> = [{ abs: startDir, rel: subDir }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await readdir(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(current.abs, entry.name);
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        stack.push({ abs, rel });
        continue;
      }

      if (!entry.isFile() || !MARKDOWN_RE.test(entry.name)) continue;
      if (skipRootDocs && !current.rel && IGNORED_ROOT_FILES.has(entry.name)) continue;

      try {
        const info = await stat(abs);
        if (!info.isFile() || info.size > MAX_INDEX_BYTES) continue;
        found.set(toPosix(rel), { absolutePath: abs, mtimeMs: info.mtimeMs, size: info.size });
      } catch {
        // File disappeared between readdir and stat.
      }
    }
  }
}

/**
 * On-demand, mtime/size-cached index of slips in a slip-box folder.
 * Holds no filesystem watchers or timers while idle.
 */
export class SlipIndex {
  private cachedRoot: string | null = null;
  private cache = new Map<string, CacheEntry>();

  async list(root: string, settings: Pick<SlipboxSettings, "includeCaptures" | "includeAgentNotes" | "includeSettled">): Promise<SlipRecord[]> {
    if (this.cachedRoot !== root) {
      this.cache.clear();
      this.cachedRoot = root;
    }

    const found = new Map<string, { absolutePath: string; mtimeMs: number; size: number }>();
    const hasStructuredMemos = await isDirectory(path.join(root, "memos"));

    if (hasStructuredMemos) {
      const folders = ["memos"];
      if (settings.includeCaptures) folders.push("captures");
      if (settings.includeAgentNotes) folders.push("scraps", "efforts");
      await Promise.all(folders.map((folder) => walkMarkdownFiles(root, folder, false, found)));
    } else {
      await walkMarkdownFiles(root, "", true, found);
    }

    for (const key of this.cache.keys()) {
      if (!found.has(key)) this.cache.delete(key);
    }

    const records: SlipRecord[] = [];
    const reads: Promise<void>[] = [];

    for (const [relativePath, meta] of found) {
      const cached = this.cache.get(relativePath);
      if (cached && cached.mtimeMs === meta.mtimeMs && cached.size === meta.size) {
        if (settings.includeSettled || !cached.record.settled) records.push(cached.record);
        continue;
      }

      reads.push(
        readFile(meta.absolutePath, "utf8")
          .then((rawText) => {
            const slash = relativePath.indexOf("/");
            const folder = slash >= 0 ? relativePath.slice(0, slash) : "";
            const base = path.posix.basename(relativePath);
            const slug = base.replace(MARKDOWN_RE, "");
            const wikiName = folder === "efforts" ? relativePath.replace(MARKDOWN_RE, "") : slug;
            const parsed = parseSlipMarkdown(rawText, slug);
            const record: SlipRecord = {
              relativePath,
              absolutePath: meta.absolutePath,
              folder,
              slug,
              wikiName,
              kind: inferKind(relativePath, folder, parsed.frontMatter.kind),
              emoji: parsed.frontMatter.emoji ?? "",
              title: parsed.title,
              summary: parsed.summary,
              about: parsed.frontMatter.about ?? "",
              settled: parsed.frontMatter.settled ?? "",
              settledAs: parsed.frontMatter.settled_as ?? "",
              rawText,
              bodyText: parsed.body,
              mtimeMs: meta.mtimeMs,
              size: meta.size,
            };
            this.cache.set(relativePath, { mtimeMs: meta.mtimeMs, size: meta.size, record });
            if (settings.includeSettled || !record.settled) records.push(record);
          })
          .catch(() => {
            this.cache.delete(relativePath);
          }),
      );
    }

    if (reads.length > 0) await Promise.all(reads);
    return records;
  }

  clear(): void {
    this.cache.clear();
    this.cachedRoot = null;
  }
}
