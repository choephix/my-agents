import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginAttachmentItem, PluginAttachmentSearchPayload } from "@getpaseo/plugin";
import type { SlipRecord } from "./index";

const MAX_RESULTS = 20;
/** Cap per-attachment text snapshot to keep search RPC payloads responsive for very large captures. */
const MAX_SNAPSHOT_CHARS = 32 * 1024;
const MAX_SUBTITLE_PREVIEW_CHARS = 96;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function projectLabel(about: string): string {
  const cleaned = about.trim().replace(/[\\/]+$/, "");
  if (!cleaned) return "";
  return path.posix.basename(cleaned.replace(/\\/g, "/"));
}

function statusLabel(slip: SlipRecord): string {
  if (!slip.settled) return "open";
  return slip.settledAs ? `settled, ${slip.settledAs} (${slip.settled})` : `settled (${slip.settled})`;
}

function formatIdentifier(slip: SlipRecord): string {
  return slip.emoji ? `${slip.emoji} [${slip.kind}]` : `[${slip.kind}]`;
}

/**
 * Extract a short single-line excerpt around `token` in `body` so Paseo's client-side Combobox
 * filter retains body-only matches and shows the user why the slip matched.
 */
function findBodyExcerpt(body: string, token: string): string | null {
  const singleLine = body.replace(/\s+/g, " ").trim();
  if (!singleLine) return null;
  const idx = singleLine.toLowerCase().indexOf(token);
  if (idx < 0) return null;
  const radius = 38;
  const start = Math.max(0, idx - radius);
  const end = Math.min(singleLine.length, idx + token.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < singleLine.length ? "…" : "";
  return `${prefix}${singleLine.slice(start, end).trim()}${suffix}`;
}

function formatSubtitle(slip: SlipRecord, tokens: readonly string[], identifier: string): string | undefined {
  const parts: string[] = [];
  if (slip.settled) {
    parts.push(slip.settledAs === "saved" ? "saved · settled" : "settled");
  }
  const refName = slip.folder === "efforts" ? slip.wikiName : slip.slug;
  if (refName.toLowerCase() !== slip.title.toLowerCase()) {
    parts.push(refName);
  }
  const project = projectLabel(slip.about);
  if (project && !refName.toLowerCase().includes(project.toLowerCase())) {
    parts.push(project);
  }

  const baseVisible = `${identifier} ${slip.title} ${slip.relativePath} ${parts.join(" ")}`.toLowerCase();
  const bodyOnlyTokens = tokens.filter((token) => !baseVisible.includes(token));

  if (bodyOnlyTokens.length > 0) {
    const snippets: string[] = [];
    let covered = baseVisible;
    for (const token of bodyOnlyTokens) {
      if (covered.includes(token)) continue;
      const excerpt = findBodyExcerpt(slip.bodyText, token);
      if (excerpt) {
        snippets.push(excerpt);
        covered += ` ${excerpt.toLowerCase()}`;
      }
      if (snippets.length >= 2) break;
    }
    if (snippets.length > 0) parts.push(snippets.join(" / "));
  } else if (slip.summary) {
    parts.push(truncate(slip.summary, MAX_SUBTITLE_PREVIEW_CHARS));
  }

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function formatSlipSnapshot(slip: SlipRecord): string {
  const header = [
    `Slip: ${slip.relativePath}`,
    `Path: ${slip.absolutePath}`,
    `Wiki link: [[${slip.wikiName}]]`,
    `Kind: ${slip.kind}`,
    `Status: ${statusLabel(slip)}`,
  ];
  if (slip.about) header.push(`About: ${slip.about}`);

  const trimmedContent = slip.rawText.trimEnd();
  if (trimmedContent.length <= MAX_SNAPSHOT_CHARS) {
    return `${header.join("\n")}\n\n${trimmedContent}`;
  }
  const clipped = trimmedContent.slice(0, MAX_SNAPSHOT_CHARS).trimEnd();
  return `${header.join("\n")}\n\n${clipped}\n\n[Truncated at ${MAX_SNAPSHOT_CHARS} chars. Read the full file at ${slip.absolutePath}.]`;
}

function toAttachmentItem(slip: SlipRecord, tokens: readonly string[]): PluginAttachmentItem {
  const identifier = formatIdentifier(slip);
  const subtitle = formatSubtitle(slip, tokens, identifier);
  return {
    id: slip.relativePath,
    identifier,
    title: slip.title,
    ...(subtitle ? { subtitle } : {}),
    url: pathToFileURL(slip.absolutePath).href,
    text: formatSlipSnapshot(slip),
    resourceType: slip.kind,
  };
}

function emptyQueryBucket(slip: SlipRecord): number {
  const isMemo = slip.folder === "memos" || slip.folder === "";
  if (!slip.settled && isMemo) return 0;
  if (!slip.settled) return 1;
  if (isMemo) return 2;
  return 3;
}

function scoreSlip(slip: SlipRecord, normalizedQuery: string, tokens: readonly string[]): number | null {
  const titleLower = slip.title.toLowerCase();
  const slugLower = slip.slug.toLowerCase();
  const pathLower = slip.relativePath.toLowerCase();
  const metaLower = `${slip.kind} ${slip.emoji} ${slip.about} ${slip.settled ? "settled" : "open"} ${slip.settledAs}`.toLowerCase();
  const summaryLower = slip.summary.toLowerCase();
  const bodyLower = slip.bodyText.toLowerCase();

  let score = 0;
  let allInPrimary = true;

  for (const token of tokens) {
    let matched = false;
    let inPrimary = false;
    if (titleLower.includes(token)) {
      score += 80;
      matched = true;
      inPrimary = true;
    }
    if (slugLower.includes(token) || pathLower.includes(token)) {
      score += 60;
      matched = true;
      inPrimary = true;
    }
    if (metaLower.includes(token)) {
      score += 45;
      matched = true;
    }
    if (summaryLower.includes(token)) {
      score += 30;
      matched = true;
    }
    if (!matched) {
      if (!bodyLower.includes(token)) return null;
      score += 15;
    }
    if (!inPrimary) allInPrimary = false;
  }

  if (titleLower === normalizedQuery || slugLower === normalizedQuery) score += 1000;
  else if (titleLower.startsWith(normalizedQuery) || slugLower.startsWith(normalizedQuery)) score += 400;
  else if (allInPrimary) score += 200;

  if (!slip.settled) {
    score += slip.folder === "memos" || slip.folder === "" ? 55 : 35;
  } else if (slip.settledAs === "saved") {
    score += 15;
  }

  return score;
}

export function searchSlips(slips: readonly SlipRecord[], query: string, limit = MAX_RESULTS): PluginAttachmentSearchPayload {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    const ordered = [...slips].sort((a, b) => {
      const bucketDiff = emptyQueryBucket(a) - emptyQueryBucket(b);
      if (bucketDiff !== 0) return bucketDiff;
      if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
      return b.relativePath.localeCompare(a.relativePath);
    });
    return { items: ordered.slice(0, limit).map((slip) => toAttachmentItem(slip, [])) };
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const scored: Array<{ slip: SlipRecord; score: number }> = [];
  for (const slip of slips) {
    const score = scoreSlip(slip, normalized, tokens);
    if (score !== null) scored.push({ slip, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.slip.mtimeMs !== a.slip.mtimeMs) return b.slip.mtimeMs - a.slip.mtimeMs;
    return b.slip.relativePath.localeCompare(a.slip.relativePath);
  });

  return {
    items: scored.slice(0, limit).map(({ slip }) => toAttachmentItem(slip, tokens)),
  };
}
