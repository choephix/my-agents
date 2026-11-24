export const SLIP_KINDS = [
  "note",
  "ask",
  "read",
  "proposal",
  "get",
  "promise",
  "track",
  "capture",
] as const;

export type SlipKind = (typeof SLIP_KINDS)[number];

export interface ParsedSlipMarkdown {
  hasFrontMatter: boolean;
  frontMatter: Record<string, string>;
  /** Ordered key-value pairs as written in front matter. */
  frontMatterEntries: Array<{ key: string; value: string }>;
  title: string;
  summary: string;
  /** Markdown after front matter, with the leading H1 stripped (used for search/previews). */
  body: string;
  /** Full markdown after front matter (preserves leading H1 for rich rendering). */
  contentWithoutFrontMatter: string;
}

export interface WikiToken {
  raw: string;
  isEmbed: boolean;
  /** Bare link target without `#fragment` or `|label`. */
  target: string;
  /** Optional fragment without leading `#` (e.g. `L10-L42` or `Some heading`). */
  fragment: string;
  /** Optional explicit display alias after `|`. */
  label: string;
}

export interface ResolvedWikiTarget {
  path: string;
  relativePath: string;
  wikiName: string;
  isImage: boolean;
  isMarkdown: boolean;
  title?: string;
  emoji?: string;
  kind?: string;
  settled?: string;
  settledAs?: string;
  previewMarkdown?: string;
}

export type SlipBodySegment =
  | { kind: "markdown"; text: string }
  | {
      kind: "embed";
      raw: string;
      target: string;
      fragment: string;
      label: string;
      resolved: ResolvedWikiTarget;
    };

const FRONT_MATTER_RE = /^---(\r?\n)(?:([\s\S]*?)(\r?\n))?---[ \t]*(?:\r?\n|$)/;
const FIELD_RE = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;
const HEADING_RE = /^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\r?\n|$)/;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const WIKI_TOKEN_RE = /(!?)\[\[([^\]\r\n]+)\]\]/g;
const LINE_RANGE_RE = /^L(\d+)(?:-L?(\d+))?$/i;

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).trim();
  }
  // Drop trailing YAML comments separated by whitespace (`value # comment`), while keeping `#` inside URLs/colors.
  const commentIndex = trimmed.search(/[ \t]+#/);
  return (commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed).trim();
}

export function parseFrontMatterEntries(raw: string): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = FIELD_RE.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = unquoteYamlScalar(match[2]);
    if (value) entries.push({ key, value });
  }
  return entries;
}

export function parseFrontMatter(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const { key, value } of parseFrontMatterEntries(raw)) {
    fields[key] = value;
  }
  return fields;
}

function stripInlineMarkdown(line: string): string {
  return line
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => (alias ?? target).trim())
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => (alias ?? target).trim())
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSummary(body: string): string {
  let inFence = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^(?:`{3,}|~{3,})/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^(?:#{1,6}\s|---+|\*\*\*+|___+|!\[\[)/.test(trimmed)) continue;
    const cleaned = stripInlineMarkdown(trimmed.replace(/^>\s?/, "").replace(/^[-*+]\s+/, ""));
    if (cleaned) return cleaned;
  }
  return "";
}

/** Parse a slip's YAML front matter, H1 title (falling back to front matter `title` or `fallbackTitle`), and lead summary. */
export function parseSlipMarkdown(content: string, fallbackTitle: string): ParsedSlipMarkdown {
  const fmMatch = FRONT_MATTER_RE.exec(content);
  const hasFrontMatter = Boolean(fmMatch);
  const frontMatterEntries = fmMatch?.[2] ? parseFrontMatterEntries(fmMatch[2]) : [];
  const frontMatter: Record<string, string> = {};
  for (const entry of frontMatterEntries) frontMatter[entry.key] = entry.value;

  const contentWithoutFrontMatter = fmMatch ? content.slice(fmMatch[0].length) : content;
  let body = contentWithoutFrontMatter;

  let title = frontMatter.title || fallbackTitle;
  const headingMatch = HEADING_RE.exec(body);
  if (headingMatch) {
    const heading = stripInlineMarkdown(headingMatch[1]);
    if (heading) title = heading;
    body = body.slice(headingMatch[0].length);
  }

  return {
    hasFrontMatter,
    frontMatter,
    frontMatterEntries,
    title,
    summary: extractSummary(body),
    body: body.trim(),
    contentWithoutFrontMatter: contentWithoutFrontMatter.replace(/^\r?\n+/, ""),
  };
}

/** Format a Date as local `YYYY-MM-DD`. */
export function formatLocalDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface SetSettledOptions {
  mode: "settle" | "save" | "reopen";
  date?: string;
  by?: string;
}

/**
 * Update or remove `settled`, `settled_by`, and `settled_as` fields in a slip's YAML front matter,
 * preserving line endings, key order, comments, and the markdown body untouched.
 */
export function setSlipSettled(content: string, options: SetSettledOptions): string {
  const date = options.date ?? formatLocalDate();
  const by = options.by ?? "user via paseo";
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const fmMatch = FRONT_MATTER_RE.exec(content);

  if (!fmMatch) {
    if (options.mode === "reopen") return content;
    const lines = [`---`, `settled: ${date}`, `settled_by: ${by}`];
    if (options.mode === "save") lines.push("settled_as: saved");
    lines.push("---", "");
    const stripped = content.replace(/^(?:\r?\n)+/, "");
    return stripped ? `${lines.join(eol)}${eol}${stripped}` : `${lines.join(eol)}${eol}`;
  }

  const rawFrontMatter = fmMatch[2] ?? "";
  const rest = content.slice(fmMatch[0].length);
  const existingLines = rawFrontMatter ? rawFrontMatter.split(/\r?\n/) : [];
  const kept = existingLines.filter((line) => {
    const match = FIELD_RE.exec(line);
    if (!match) return true;
    const key = match[1].toLowerCase();
    return key !== "settled" && key !== "settled_by" && key !== "settled_as";
  });

  if (options.mode === "settle" || options.mode === "save") {
    kept.push(`settled: ${date}`);
    kept.push(`settled_by: ${by}`);
    if (options.mode === "save") kept.push("settled_as: saved");
  }

  const fmBlock = kept.length > 0 ? `---${eol}${kept.join(eol)}${eol}---` : `---${eol}---`;
  const trailing = fmMatch[0].endsWith("\r\n") ? "\r\n" : fmMatch[0].endsWith("\n") ? "\n" : "";
  return `${fmBlock}${trailing}${rest}`;
}

/** Parse a single `[[...]]` or `![[...]]` inner text (`target#fragment|label`). */
export function parseWikiInner(inner: string, isEmbed: boolean, raw: string): WikiToken | null {
  const pipeIdx = inner.indexOf("|");
  const refPart = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
  const label = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : "";
  if (!refPart) return null;

  const hashIdx = refPart.indexOf("#");
  const target = (hashIdx >= 0 ? refPart.slice(0, hashIdx) : refPart).trim();
  const fragment = hashIdx >= 0 ? refPart.slice(hashIdx + 1).trim() : "";
  if (!target) return null;

  return { raw, isEmbed, target, fragment, label };
}

/** Compute inline code spans `[start, end)` on a single line so wiki syntax inside backticks is untouched. */
function inlineCodeSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let ticks = 0;
    while (i + ticks < line.length && line[i + ticks] === "`") ticks++;
    const close = line.indexOf("`".repeat(ticks), i + ticks);
    if (close < 0) {
      i += ticks;
      continue;
    }
    spans.push([i, close + ticks]);
    i = close + ticks;
  }
  return spans;
}

function insideSpans(index: number, spans: ReadonlyArray<[number, number]>): boolean {
  for (const [start, end] of spans) {
    if (index >= start && index < end) return true;
  }
  return false;
}

function updateFenceState(
  line: string,
  fence: { char: string; length: number } | null,
): { char: string; length: number } | null {
  const match = FENCE_RE.exec(line);
  if (!match) return fence;
  const marker = match[1];
  const char = marker[0];
  if (!fence) return { char, length: marker.length };
  if (fence.char === char && marker.length >= fence.length && line.slice(match[0].length).trim() === "") {
    return null;
  }
  return fence;
}

/** Build a `file://` URL with optional `#L10` / `#L10-L42` fragment for Paseo's Markdown link handler. */
export function buildFileLinkUrl(filePath: string, fragment = ""): string {
  const base = `file://${encodeURI(filePath)}`;
  if (!fragment) return base;
  const lineMatch = LINE_RANGE_RE.exec(fragment);
  if (!lineMatch) return base;
  const start = lineMatch[1];
  const end = lineMatch[2];
  return end && end !== start ? `${base}#L${start}-L${end}` : `${base}#L${start}`;
}

export function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/([\\[\]])/g, "\\$1");
}

function defaultTokenLabel(token: WikiToken, resolved?: ResolvedWikiTarget): string {
  if (token.label) return token.label;
  if (resolved?.title && !token.fragment) {
    return resolved.emoji ? `${resolved.emoji} ${resolved.title}` : resolved.title;
  }
  return token.fragment ? `${token.target}#${token.fragment}` : token.target;
}

/** Collect all unique wiki link targets and embed targets referenced outside code blocks and inline code. */
export function extractWikiReferences(markdown: string): {
  linkTargets: string[];
  embedRequests: Array<{ target: string; fragment: string }>;
} {
  const linkTargets = new Set<string>();
  const embedMap = new Map<string, { target: string; fragment: string }>();
  let fence: { char: string; length: number } | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const nextFence = updateFenceState(line, fence);
    if (nextFence !== fence) {
      fence = nextFence;
      continue;
    }
    if (fence) continue;

    const codeSpans = inlineCodeSpans(line);
    WIKI_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKI_TOKEN_RE.exec(line)) !== null) {
      if (insideSpans(match.index, codeSpans)) continue;
      const token = parseWikiInner(match[2], match[1] === "!", match[0]);
      if (!token) continue;
      linkTargets.add(token.target);
      if (token.isEmbed) {
        const key = `${token.target}#${token.fragment}`;
        if (!embedMap.has(key)) embedMap.set(key, { target: token.target, fragment: token.fragment });
      }
    }
  }

  return {
    linkTargets: [...linkTargets],
    embedRequests: [...embedMap.values()],
  };
}

/**
 * Rewrite `[[wiki]]` links into clickable Paseo `file://` Markdown links, `![[image]]` embeds into
 * Markdown images, and standalone `![[slip]]` embeds into structured card segments.
 */
export function segmentSlipBody(
  markdown: string,
  resolvedTargets: Readonly<Record<string, ResolvedWikiTarget>>,
  embedPreviews?: Readonly<Record<string, string>>,
): SlipBodySegment[] {
  const segments: SlipBodySegment[] = [];
  let buffer: string[] = [];
  let fence: { char: string; length: number } | null = null;

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join("\n");
    if (text.trim()) segments.push({ kind: "markdown", text });
    buffer = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const nextFence = updateFenceState(line, fence);
    if (nextFence !== fence) {
      fence = nextFence;
      buffer.push(line);
      continue;
    }
    if (fence) {
      buffer.push(line);
      continue;
    }

    // Standalone Markdown slip embed on its own line -> render as an inset slip card.
    const trimmed = line.trim();
    if (trimmed.startsWith("![[") && trimmed.endsWith("]]") && trimmed.indexOf("]]") === trimmed.length - 2) {
      const token = parseWikiInner(trimmed.slice(3, -2), true, trimmed);
      const target = token ? resolvedTargets[token.target] : undefined;
      if (token && target && target.isMarkdown && !target.isImage) {
        flush();
        const key = `${token.target}#${token.fragment}`;
        const previewMarkdown = embedPreviews?.[key] ?? target.previewMarkdown;
        segments.push({
          kind: "embed",
          raw: token.raw,
          target: token.target,
          fragment: token.fragment,
          label: defaultTokenLabel(token, target),
          resolved: previewMarkdown !== undefined ? { ...target, previewMarkdown } : target,
        });
        continue;
      }
    }

    const codeSpans = inlineCodeSpans(line);
    WIKI_TOKEN_RE.lastIndex = 0;
    let out = "";
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKI_TOKEN_RE.exec(line)) !== null) {
      if (insideSpans(match.index, codeSpans)) continue;
      const token = parseWikiInner(match[2], match[1] === "!", match[0]);
      if (!token) continue;
      const target = resolvedTargets[token.target];
      if (!target) continue;

      out += line.slice(lastIndex, match.index);
      const url = buildFileLinkUrl(target.path, token.fragment);
      const label = escapeMarkdownLinkLabel(defaultTokenLabel(token, target));
      if (token.isEmbed && target.isImage) {
        out += `![${label}](<${url}>)`;
      } else {
        out += `[${label}](<${url}>)`;
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex > 0) {
      out += line.slice(lastIndex);
      buffer.push(out);
    } else {
      buffer.push(line);
    }
  }

  flush();
  return segments;
}

/** Rewrite inline `[[wiki]]` links inside a single string (used for `from:` header values and nested previews). */
export function rewriteInlineWikiLinks(
  text: string,
  resolvedTargets: Readonly<Record<string, ResolvedWikiTarget>>,
): string {
  const segments = segmentSlipBody(text, resolvedTargets);
  return segments
    .map((segment) => {
      if (segment.kind === "markdown") return segment.text;
      const url = buildFileLinkUrl(segment.resolved.path, segment.fragment);
      return `[${escapeMarkdownLinkLabel(segment.label)}](<${url}>)`;
    })
    .join("\n\n");
}

/** Convert a slip title into a clean lowercase filename slug. */
export function slugifySlipTitle(title: string): string {
  const normalized = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
    .replace(/-+$/, "");
  return normalized || "slip";
}

const SLIP_KIND_SET = new Set<string>(SLIP_KINDS);

export interface ParsedSlashSlipInput {
  kind: SlipKind;
  title: string;
  body: string;
}

/**
 * Parse `/slip [kind:] <text>` into `{ kind, title, body }`.
 * Multi-line input uses the first line as the title and the rest as the body.
 */
export function parseSlipCommandInput(raw: string): ParsedSlashSlipInput | null {
  let text = raw.trim();
  if (!text) return null;

  let kind: SlipKind = "note";
  const prefix = /^([a-z]+):[ \t]+([\s\S]+)$/i.exec(text);
  if (prefix && SLIP_KIND_SET.has(prefix[1].toLowerCase())) {
    kind = prefix[1].toLowerCase() as SlipKind;
    text = prefix[2].trim();
  }
  if (!text) return null;

  const lines = text.split(/\r?\n/);
  if (lines.length > 1) {
    const first = lines[0].replace(/^#+\s*/, "").trim();
    const rest = lines.slice(1).join("\n").trim();
    return { kind, title: first || "Quick slip", body: rest };
  }

  const single = text.replace(/^#+\s*/, "").trim();
  if (single.length <= 96) {
    return { kind, title: single, body: "" };
  }
  const sentenceEnd = single.search(/[.!?](?:\s|$)/);
  if (sentenceEnd > 12 && sentenceEnd <= 96) {
    return {
      kind,
      title: single.slice(0, sentenceEnd + 1).trim(),
      body: single,
    };
  }
  const clipped = single.slice(0, 72).replace(/\s+\S*$/, "").trim() || single.slice(0, 72);
  return { kind, title: clipped, body: single };
}
