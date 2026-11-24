import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  extractWikiReferences,
  parseSlipMarkdown,
  type ResolvedWikiTarget,
  rewriteInlineWikiLinks,
} from "../shared/frontmatter";
import type { SlipIndex, SlipRecord } from "./index";

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".revisions", ".obsidian"]);
const LINE_RANGE_RE = /^L(\d+)(?:-L?(\d+))?$/i;
const MAX_EMBED_PREVIEW_CHARS = 8 * 1024;
const MAX_BACKLINKS = 25;

interface BoxFileEntry {
  relativePath: string;
  absolutePath: string;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isInsideFolder(filePath: string, folder: string): boolean {
  const rel = path.relative(path.resolve(folder), path.resolve(filePath));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function hasTraversal(target: string): boolean {
  const parts = target.replace(/\\/g, "/").split("/");
  return parts.some((part) => part === "." || part === "..");
}

function suffixMatches(relativePath: string, query: string, allowMarkdownExt: boolean): boolean {
  const normRel = relativePath.toLowerCase();
  const normQuery = query.replace(/^\/+/, "").replace(/\\/g, "/").toLowerCase();
  if (!normQuery) return false;

  const candidates = [normQuery];
  if (allowMarkdownExt && !path.posix.extname(normQuery)) {
    candidates.push(`${normQuery}.md`, `${normQuery}.markdown`);
  }

  for (const candidate of candidates) {
    if (normRel === candidate || normRel.endsWith(`/${candidate}`)) return true;
  }
  return false;
}

async function listAttachmentFiles(boxFolder: string): Promise<BoxFileEntry[]> {
  const found: BoxFileEntry[] = [];
  const startDirs = [path.join(boxFolder, "attachments")];

  for (const startDir of startDirs) {
    const stack: Array<{ abs: string; rel: string }> = [{ abs: startDir, rel: "attachments" }];
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
        const rel = `${current.rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          stack.push({ abs, rel });
        } else if (entry.isFile()) {
          found.push({ relativePath: toPosix(rel), absolutePath: abs });
        }
      }
    }
  }
  return found;
}

function extractHeadingSection(markdown: string, headingText: string): string | null {
  const wanted = headingText.trim().toLowerCase();
  if (!wanted) return null;

  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let startLine = -1;
  let startLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (!match) continue;
    const level = match[1].length;
    const text = match[2].trim().toLowerCase();

    if (startLine < 0) {
      if (text === wanted) {
        startLine = i + 1;
        startLevel = level;
      }
    } else if (level <= startLevel) {
      return lines.slice(startLine, i).join("\n").trim();
    }
  }

  return startLine >= 0 ? lines.slice(startLine).join("\n").trim() : null;
}

function extractLineRange(rawText: string, fragment: string): string | null {
  const match = LINE_RANGE_RE.exec(fragment);
  if (!match) return null;
  const start = Math.max(1, Number.parseInt(match[1], 10));
  const end = match[2] ? Math.max(start, Number.parseInt(match[2], 10)) : start;
  const lines = rawText.split(/\r?\n/);
  return lines.slice(start - 1, end).join("\n").trim();
}

function clipPreview(markdown: string): string {
  if (markdown.length <= MAX_EMBED_PREVIEW_CHARS) return markdown;
  return `${markdown.slice(0, MAX_EMBED_PREVIEW_CHARS).trimEnd()}\n\n…`;
}

function buildTargetResolver(slips: readonly SlipRecord[], attachments: readonly BoxFileEntry[]) {
  const resolveSingle = (target: string): { slip?: SlipRecord; attachment?: BoxFileEntry } | null => {
    const trimmed = target.trim();
    if (!trimmed || hasTraversal(trimmed)) return null;

    const slipMatches = slips.filter((slip) => suffixMatches(slip.relativePath, trimmed, true));
    if (slipMatches.length === 1) return { slip: slipMatches[0] };
    if (slipMatches.length > 1) {
      // Prefer exact wikiName match if one exists (e.g. `memos/` over `scraps/`).
      const exactWiki = slipMatches.filter((s) => s.wikiName.toLowerCase() === trimmed.toLowerCase());
      if (exactWiki.length === 1) return { slip: exactWiki[0] };
      const inMemos = slipMatches.filter((s) => s.folder === "memos");
      if (inMemos.length === 1) return { slip: inMemos[0] };
      return { slip: slipMatches[0] };
    }

    const attachmentMatches = attachments.filter((file) => suffixMatches(file.relativePath, trimmed, false));
    if (attachmentMatches.length >= 1) return { attachment: attachmentMatches[0] };

    return null;
  };

  return resolveSingle;
}

function toResolvedTarget(match: { slip?: SlipRecord; attachment?: BoxFileEntry }): ResolvedWikiTarget {
  if (match.slip) {
    const s = match.slip;
    return {
      path: s.absolutePath,
      relativePath: s.relativePath,
      wikiName: s.wikiName,
      isImage: false,
      isMarkdown: true,
      title: s.title,
      ...(s.emoji ? { emoji: s.emoji } : {}),
      kind: s.kind,
      ...(s.settled ? { settled: s.settled } : {}),
      ...(s.settledAs ? { settledAs: s.settledAs } : {}),
    };
  }
  const file = match.attachment!;
  const base = path.posix.basename(file.relativePath);
  return {
    path: file.absolutePath,
    relativePath: file.relativePath,
    wikiName: base,
    isImage: IMAGE_EXT_RE.test(base),
    isMarkdown: MARKDOWN_EXT_RE.test(base),
  };
}

function referencesSlip(slip: SlipRecord, needles: ReadonlySet<string>): boolean {
  const { linkTargets } = extractWikiReferences(slip.rawText);
  for (const target of linkTargets) {
    const normalized = target.replace(/^\/+/, "").replace(/\\/g, "/").replace(MARKDOWN_EXT_RE, "").toLowerCase();
    if (needles.has(normalized)) return true;
  }
  return false;
}

export interface ResolveSlipContextInput {
  boxFolder: string | null;
  filePath: string;
  targets: readonly string[];
  embedRequests?: ReadonlyArray<{ target: string; fragment: string }>;
  includeBacklinks?: boolean;
  index: SlipIndex;
}

export interface ResolveSlipContextResult {
  boxFolder: string | null;
  inBox: boolean;
  relativePath: string | null;
  folder: string | null;
  wikiName: string | null;
  resolved: Record<string, ResolvedWikiTarget>;
  embedPreviews: Record<string, string>;
  backlinks: Array<{
    path: string;
    relativePath: string;
    wikiName: string;
    title: string;
    emoji: string;
    kind: string;
    settled: string;
  }>;
}

export async function resolveSlipContext({
  boxFolder,
  filePath,
  targets,
  embedRequests = [],
  includeBacklinks = false,
  index,
}: ResolveSlipContextInput): Promise<ResolveSlipContextResult> {
  if (!boxFolder) {
    return {
      boxFolder: null,
      inBox: false,
      relativePath: null,
      folder: null,
      wikiName: null,
      resolved: {},
      embedPreviews: {},
      backlinks: [],
    };
  }

  let boxExists = false;
  try {
    boxExists = (await stat(boxFolder)).isDirectory();
  } catch {
    boxExists = false;
  }
  if (!boxExists) {
    return {
      boxFolder,
      inBox: false,
      relativePath: null,
      folder: null,
      wikiName: null,
      resolved: {},
      embedPreviews: {},
      backlinks: [],
    };
  }

  const resolvedFilePath = path.resolve(filePath);
  const inBox = isInsideFolder(resolvedFilePath, boxFolder);
  const relativePath = inBox ? toPosix(path.relative(path.resolve(boxFolder), resolvedFilePath)) : null;
  const slash = relativePath ? relativePath.indexOf("/") : -1;
  const folder = relativePath ? (slash >= 0 ? relativePath.slice(0, slash) : "") : null;
  const slug = relativePath ? path.posix.basename(relativePath).replace(MARKDOWN_EXT_RE, "") : null;
  const wikiName =
    relativePath && slug
      ? folder === "efforts"
        ? relativePath.replace(MARKDOWN_EXT_RE, "")
        : slug
      : null;

  const needSlips = targets.length > 0 || embedRequests.length > 0 || (includeBacklinks && inBox);
  if (!needSlips) {
    return {
      boxFolder,
      inBox,
      relativePath,
      folder,
      wikiName,
      resolved: {},
      embedPreviews: {},
      backlinks: [],
    };
  }

  const allSlips = await index.list(boxFolder, {
    includeCaptures: true,
    includeAgentNotes: true,
    includeSettled: true,
  });

  const needsAttachments = targets.some((t) => IMAGE_EXT_RE.test(t) || t.includes("."));
  const attachments = needsAttachments ? await listAttachmentFiles(boxFolder) : [];
  const resolveSingle = buildTargetResolver(allSlips, attachments);

  const resolved: Record<string, ResolvedWikiTarget> = {};
  const resolvedSlips = new Map<string, SlipRecord>();

  for (const target of targets) {
    if (resolved[target]) continue;
    const match = resolveSingle(target);
    if (!match) continue;
    resolved[target] = toResolvedTarget(match);
    if (match.slip) resolvedSlips.set(target, match.slip);
  }

  const embedPreviews: Record<string, string> = {};
  for (const req of embedRequests) {
    const key = `${req.target}#${req.fragment}`;
    if (embedPreviews[key] !== undefined) continue;
    const slip = resolvedSlips.get(req.target) ?? resolveSingle(req.target)?.slip;
    if (!slip) continue;

    // Prevent self-embedding cycles.
    if (path.resolve(slip.absolutePath) === resolvedFilePath) {
      embedPreviews[key] = "*Already open above.*";
      continue;
    }

    let raw = slip.rawText;
    if (!raw) {
      try {
        raw = await readFile(slip.absolutePath, "utf8");
      } catch {
        continue;
      }
    }

    let snippet: string;
    if (req.fragment) {
      const byLines = extractLineRange(raw, req.fragment);
      if (byLines !== null) {
        snippet = byLines;
      } else {
        const parsed = parseSlipMarkdown(raw, slip.slug);
        snippet = extractHeadingSection(parsed.contentWithoutFrontMatter, req.fragment) ?? parsed.body;
      }
    } else {
      const parsed = parseSlipMarkdown(raw, slip.slug);
      snippet = parsed.contentWithoutFrontMatter;
    }

    // Resolve nested wiki links inside the embedded preview so they remain clickable.
    const nestedRefs = extractWikiReferences(snippet);
    const nestedMap: Record<string, ResolvedWikiTarget> = {};
    for (const nestedTarget of nestedRefs.linkTargets) {
      const found = resolveSingle(nestedTarget);
      if (found) nestedMap[nestedTarget] = toResolvedTarget(found);
    }
    embedPreviews[key] = clipPreview(rewriteInlineWikiLinks(snippet, nestedMap));
  }

  const backlinks: ResolveSlipContextResult["backlinks"] = [];
  if (includeBacklinks && inBox && relativePath && wikiName) {
    const needles = new Set<string>([
      wikiName.toLowerCase(),
      relativePath.replace(MARKDOWN_EXT_RE, "").toLowerCase(),
    ]);
    if (slug && folder !== "efforts") needles.add(slug.toLowerCase());

    const matching = allSlips.filter(
      (slip) => path.resolve(slip.absolutePath) !== resolvedFilePath && referencesSlip(slip, needles),
    );
    matching.sort((a, b) => {
      const openDiff = Number(Boolean(a.settled)) - Number(Boolean(b.settled));
      if (openDiff !== 0) return openDiff;
      if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
      return a.relativePath.localeCompare(b.relativePath);
    });
    for (const slip of matching.slice(0, MAX_BACKLINKS)) {
      backlinks.push({
        path: slip.absolutePath,
        relativePath: slip.relativePath,
        wikiName: slip.wikiName,
        title: slip.title,
        emoji: slip.emoji,
        kind: slip.kind,
        settled: slip.settled,
      });
    }
  }

  return {
    boxFolder,
    inBox,
    relativePath,
    folder,
    wikiName,
    resolved,
    embedPreviews,
    backlinks,
  };
}
