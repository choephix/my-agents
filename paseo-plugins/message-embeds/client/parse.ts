import { type AgentLink, parseAgentLink } from "./agent-link";

export interface Embed {
  original: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
}

export type Segment =
  | { kind: "markdown"; text: string }
  | { kind: "embed"; embed: Embed }
  | { kind: "agent"; url: string; link: AgentLink };

const EMBED = /!\[\[([^\]\r\n]+?)\]\]/g;
// Any indent: agents nest fences inside list items deeper than CommonMark's three spaces.
const FENCE_START = /^\s*(`{3,}|~{3,})/;

function parseEmbed(original: string, inner: string): Embed | null {
  const range = /^(.*?)(?:#L(\d+)(?:-L?(\d+))?)?$/.exec(inner);
  if (!range || !range[1].trim()) return null;
  const lineStart = range[2] ? Number(range[2]) : undefined;
  const lineEnd = range[3] ? Number(range[3]) : lineStart;
  if (lineStart !== undefined && lineEnd !== undefined && lineEnd < lineStart) return null;
  return { original, path: range[1], ...(lineStart ? { lineStart } : {}), ...(lineEnd ? { lineEnd } : {}) };
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

// `#123` after a line start, space or opening bracket; two digits or more, so "option #2" stays text.
const ISSUE_REF = /(^|[\s([])#(\d{2,})(?![\w-])/g;

/**
 * Rewrites `#123` outside fenced blocks and inline code with `link(number)`, e.g. into a Markdown link.
 * Text inside existing Markdown links (`[see #12](…)`) is left alone.
 */
export function linkIssueRefs(text: string, link: (number: string) => string): string {
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
    const spans = inlineCodeSpans(line);
    for (const match of line.matchAll(/\[[^\]\n]*\]\([^)\n]*\)/g)) spans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
    return line.replace(ISSUE_REF, (whole, lead: string, number: string, offset: number) =>
      isInside(spans, offset + lead.length) ? whole : `${lead}${link(number)}`);
  }).join("\n");
}

/**
 * Splits assistant text into markdown, complete Obsidian-style file embeds, and agent embeds
 * (`![[https://app.paseo.sh/h/<serverId>/agent/<agentId>]]`). An agent embed becomes a card only
 * on a line of its own; inside a sentence it is written back as the plain link.
 * Fenced blocks and inline-code spans are always left untouched.
 */
export function parseMessage(text: string): Segment[] {
  const out: Segment[] = [];
  let inFence: { marker: string; char: string } | null = null;
  let offset = 0;

  while (offset <= text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline + 1;
    const fullLine = text.slice(offset, end);
    const line = fullLine.endsWith("\n") ? fullLine.slice(0, -1) : fullLine;
    const fence = FENCE_START.exec(line);
    if (inFence) {
      if (fence && fence[1][0] === inFence.char && fence[1].length >= inFence.marker.length) inFence = null;
      appendMarkdown(out, fullLine);
    } else if (fence) {
      inFence = { marker: fence[1], char: fence[1][0] };
      appendMarkdown(out, fullLine);
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
  return out;
}
