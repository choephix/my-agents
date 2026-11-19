import { isVaultName } from "../shared/preferences";
import { type AgentLink, parseAgentLink } from "./agent-link";

export interface Embed {
  original: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
  /** `#Some heading`: that heading's section. */
  heading?: string;
  /** `|Label`: shown in place of the original text. */
  alias?: string;
}

export type Segment =
  | { kind: "markdown"; text: string }
  | { kind: "embed"; embed: Embed }
  | { kind: "agent"; url: string; link: AgentLink }
  /** A complete ```svg fenced block; `source` is the code without the fence and its indent. */
  | { kind: "svg"; source: string };

const EMBED = /!\[\[([^\]\r\n]+?)\]\]/g;
// Any indent: agents nest fences inside list items deeper than CommonMark's three spaces.
const FENCE_START = /^\s*(`{3,}|~{3,})/;
/** Any line opening a ```svg or ~~~svg fence; a cheap pre-check before parsing. */
export const SVG_FENCE = /^\s*(?:`{3,}|~{3,})\s*svg(?:\s|$)/im;

/** `path[#fragment][|alias]`, trimmed; null for an empty path. */
function splitTarget(inner: string): { path: string; fragment: string; alias: string } | null {
  const [ref, ...aliasParts] = inner.split("|");
  const hash = ref.indexOf("#");
  const path = (hash < 0 ? ref : ref.slice(0, hash)).trim();
  if (!path) return null;
  return { path, fragment: hash < 0 ? "" : ref.slice(hash + 1).trim(), alias: aliasParts.join("|").trim() };
}

/** A `#L10`, `#L10-42` or `#L10-L42` fragment (any case) as lines; null when it is not one, "invalid" when backwards. */
function lineRange(fragment: string): { lineStart: number; lineEnd: number } | "invalid" | null {
  const range = /^L(\d+)(?:-L?(\d+))?$/i.exec(fragment);
  if (!range) return null;
  const lineStart = Number(range[1]);
  const lineEnd = range[2] ? Number(range[2]) : lineStart;
  return lineStart < 1 || lineEnd < lineStart ? "invalid" : { lineStart, lineEnd };
}

/** The syntax of omp's md-embed extension: `path`, then `#L10-L42` or `#Heading`, then `|Label`. */
function parseEmbed(original: string, inner: string): Embed | null {
  const target = splitTarget(inner);
  if (!target) return null;
  const embed: Embed = { original, path: target.path, ...(target.alias ? { alias: target.alias } : {}) };
  if (!target.fragment) return embed;
  const range = lineRange(target.fragment);
  if (range === "invalid") return null;
  return range ? { ...embed, ...range } : { ...embed, heading: target.fragment };
}

/** Returns inline-code spans for one non-fenced line. Spans are [start, end), including backticks. */
function inlineCodeSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  while (cursor < line.length) {
    const start = line.indexOf("`", cursor);
    if (start < 0) break;
    let run = 1;
    while (line[start + run] === "`") run++;
    const marker = "`".repeat(run);
    const end = line.indexOf(marker, start + run);
    if (end < 0) {
      // An unmatched backtick is still code from here to the end, matching Markdown's safe behavior.
      spans.push([start, line.length]);
      break;
    }
    spans.push([start, end + run]);
    cursor = end + run;
  }
  return spans;
}

function isInside(spans: Array<[number, number]>, position: number): boolean {
  return spans.some(([start, end]) => position >= start && position < end);
}

function appendMarkdown(out: Segment[], text: string): void {
  if (!text) return;
  const previous = out[out.length - 1];
  if (previous?.kind === "markdown") previous.text += text;
  else out.push({ kind: "markdown", text });
}

/** Runs `edit` on every line outside fenced code blocks; fence lines and their contents pass through. */
function mapProseLines(text: string, edit: (line: string) => string): string {
  let inFence: string | null = null;
  return text.split("\n").map((line) => {
    const fence = FENCE_START.exec(line)?.[1];
    if (inFence) {
      if (fence && fence[0] === inFence[0] && fence.length >= inFence.length) inFence = null;
      return line;
    }
    if (fence) {
      inFence = fence;
      return line;
    }
    return edit(line);
  }).join("\n");
}

/** Spans of complete Markdown links, `[text](url)`, on one line. */
function markdownLinkSpans(line: string): Array<[number, number]> {
  return [...line.matchAll(/\[[^\]\n]*\]\([^)\n]*\)/g)].map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
}

// `#123` after a line start, space or opening bracket; two digits or more, so "option #2" stays text.
const ISSUE_REF = /(^|[\s([])#(\d{2,})(?![\w-])/g;

/**
 * Rewrites `#123` outside fenced blocks and inline code with `link(number)`, e.g. into a Markdown link.
 * Text inside existing Markdown links (`[see #12](…)`) is left alone.
 */
export function linkIssueRefs(text: string, link: (number: string) => string): string {
  return mapProseLines(text, (line) => {
    const spans = [...inlineCodeSpans(line), ...markdownLinkSpans(line)];
    return line.replace(ISSUE_REF, (whole, lead: string, number: string, offset: number) =>
      isInside(spans, offset + lead.length) ? whole : `${lead}${link(number)}`);
  });
}

const WIKILINK = /(?<![![])\[\[([^[\]\n]+?)\]\](?!\])/g;

export interface WikiLinkOptions {
  /** Leave vault names (not `/` or `~/`) as written, for a later pass that knows the vault. */
  skipVaultNames?: boolean;
  /** Vault names found in the vault folder, to their absolute paths. */
  vaultPaths?: ReadonlyMap<string, string>;
}

/** Runs `visit` on each wiki link outside code and Markdown links; its return value replaces the link. */
function mapWikiLinks(text: string, visit: (whole: string, target: { path: string; fragment: string; alias: string }) => string): string {
  return mapProseLines(text, (line) => {
    if (!line.includes("[[")) return line;
    const spans = [...inlineCodeSpans(line), ...markdownLinkSpans(line)];
    return line.replace(WIKILINK, (whole, inner: string, offset: number) => {
      const target = splitTarget(inner);
      return !target || isInside(spans, offset) || target.path.includes("://") ? whole : visit(whole, target);
    });
  });
}

/**
 * Rewrites plain `[[path#fragment|Label]]` wiki links outside code and Markdown links as Markdown
 * links, which Paseo opens in its file panel. Only targets that look like files are rewritten: a
 * `/` or `~/` path, a path with an extension, or a vault name found in the vault folder. The label
 * is the alias, else the file name with its fragment; a line range also goes on the link.
 */
export function linkWikiLinks(text: string, options: WikiLinkOptions = {}): string {
  return mapWikiLinks(text, (whole, target) => {
    const vaultName = isVaultName(target.path);
    if (vaultName && options.skipVaultNames) return whole;
    const vaultPath = vaultName ? options.vaultPaths?.get(target.path) : undefined;
    if (!vaultPath && !/^~?\//.test(target.path) && !/\.[a-z\d]+$/i.test(target.path)) return whole;
    const range = lineRange(target.fragment);
    if (range === "invalid") return whole;
    const name = target.path.slice(target.path.lastIndexOf("/") + 1);
    const label = (target.alias || `${name}${target.fragment ? `#${target.fragment}` : ""}`).replace(/[\\[\]]/g, "\\$&");
    const lines = range ? `#L${range.lineStart}${range.lineEnd === range.lineStart ? "" : `-L${range.lineEnd}`}` : "";
    return `[${label}](${encodeURI(vaultPath ?? target.path).replace(/[()]/g, (paren) => (paren === "(" ? "%28" : "%29"))}${lines})`;
  });
}

/** The vault names of the wiki links `linkWikiLinks` would look up in the vault folder, sorted, once each. */
export function vaultWikiNames(text: string): string[] {
  if (!text.includes("[[")) return [];
  const names = new Set<string>();
  mapWikiLinks(text, (whole, target) => {
    if (isVaultName(target.path)) names.add(target.path);
    return whole;
  });
  return [...names].sort();
}

/** Embeds outside code written as wiki links (chat embeds as their plain link), for embeds nested too deep to expand. */
export function embedsAsLinks(text: string): string {
  if (!text.includes("![[")) return text;
  return mapProseLines(text, (line) => {
    const spans = inlineCodeSpans(line);
    return line.replace(EMBED, (whole, inner: string, offset: number) => {
      if (isInside(spans, offset)) return whole;
      return parseAgentLink(inner) ? inner.trim() : whole.slice(1);
    });
  });
}

// `#rgb`, `#rrggbb` or `#rrggbbaa` as a whole token: not after a word character, a backslash
// escape or URL punctuation (`page#abc`, `/#fff`, `&#123;`), and not followed by more of a word.
const HEX_COLOR = /(?<![\w#&/?=%\\])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3})(?![\w-])/gi;

/**
 * Inserts `swatch(hex)` before each hex colour outside fenced blocks and Markdown links. Inside
 * inline code the swatch goes before the code span. All-digit hexes (`#000`, `#123`) count only
 * inside inline code: in prose they are GitHub issue numbers. Headings and table rows (any `|`
 * outside inline code) are skipped: Paseo draws an image there at full picture size, not inline.
 */
export function addColorSwatches(text: string, swatch: (hex: string) => string): string {
  return mapProseLines(text, (line) => {
    const code = inlineCodeSpans(line);
    if (/^\s{0,3}#{1,6}\s/.test(line) || [...line.matchAll(/\|/g)].some((pipe) => !isInside(code, pipe.index ?? 0))) return line;
    const links = markdownLinkSpans(line);
    let out = "";
    let cursor = 0;
    for (const match of line.matchAll(HEX_COLOR)) {
      const at = match.index ?? 0;
      const span = code.find(([start, end]) => at >= start && at < end);
      if (isInside(links, at) || (!span && /^#\d+$/.test(match[0]))) continue;
      const before = span ? span[0] : at;
      out += line.slice(cursor, before) + swatch(match[0]);
      cursor = before;
    }
    return out ? out + line.slice(cursor) : line;
  });
}

/**
 * Splits assistant text into markdown, complete Obsidian-style file embeds, and agent embeds
 * (`![[https://app.paseo.sh/h/<serverId>/agent/<agentId>]]`). File embeds follow omp's md-embed
 * syntax: `![[path]]`, `![[path#L10-L42]]`, `![[path#Some heading]]`, each optionally `|Label`.
 * An agent embed becomes a card only on a line of its own; inside a sentence it is written back as the plain link.
 * Fenced blocks and inline-code spans are left untouched, except that with `svg` on, a closed
 * ```svg block becomes its own segment; an unclosed one stays markdown.
 */
export function parseMessage(text: string, options: { svg?: boolean } = {}): Segment[] {
  const out: Segment[] = [];
  let inFence: { marker: string; char: string; svg: { raw: string; lines: string[]; indent: number } | null } | null = null;
  let offset = 0;

  while (offset <= text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline + 1;
    const fullLine = text.slice(offset, end);
    const line = fullLine.endsWith("\n") ? fullLine.slice(0, -1) : fullLine;
    const fence = FENCE_START.exec(line);
    if (inFence) {
      const closes = fence !== null && fence[1][0] === inFence.char && fence[1].length >= inFence.marker.length;
      const svg = inFence.svg;
      if (svg && closes) out.push({ kind: "svg", source: svg.lines.join("\n") });
      else if (svg) {
        svg.raw += fullLine;
        // Lines of a fence indented in a list item carry the list indent; drop up to that much.
        svg.lines.push(line.replace(new RegExp(`^ {0,${svg.indent}}`), ""));
      } else appendMarkdown(out, fullLine);
      if (closes) inFence = null;
    } else if (fence) {
      const svg = options.svg === true && /^svg(?:\s|$)/i.test(line.slice(fence[0].length).trim());
      inFence = { marker: fence[1], char: fence[1][0], svg: svg ? { raw: fullLine, lines: [], indent: fence[0].length - fence[1].length } : null };
      if (!svg) appendMarkdown(out, fullLine);
    } else {
      const spans = inlineCodeSpans(line);
      let cursor = 0;
      for (const match of line.matchAll(EMBED)) {
        const start = match.index ?? 0;
        const original = match[0];
        if (isInside(spans, start)) continue;
        const agent = parseAgentLink(match[1]);
        if (agent) {
          const url = match[1].trim();
          appendMarkdown(out, fullLine.slice(cursor, start));
          if (line.trim() === original) out.push({ kind: "agent", url, link: agent });
          else appendMarkdown(out, url);
          cursor = start + original.length;
          continue;
        }
        const parsed = parseEmbed(original, match[1]);
        if (!parsed) continue;
        appendMarkdown(out, fullLine.slice(cursor, start));
        out.push({ kind: "embed", embed: parsed });
        cursor = start + original.length;
      }
      if (cursor) appendMarkdown(out, fullLine.slice(cursor));
      else appendMarkdown(out, fullLine);
    }
    if (newline < 0) break;
    offset = end;
  }
  if (inFence?.svg) appendMarkdown(out, inFence.svg.raw);
  return out;
}
