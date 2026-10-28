export interface Embed {
  id: string;
  original: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
}

export type Segment =
  | { kind: "markdown"; id: string; text: string }
  | { kind: "embed"; embed: Embed };

const EMBED = /!\[\[([^\]\r\n]+?)\]\]/g;
const FENCE_START = /^ {0,3}(`{3,}|~{3,})/;

function parseEmbed(original: string, inner: string, id: string): Embed | null {
  const range = /^(.*?)(?:#L(\d+)(?:-(\d+))?)?$/.exec(inner);
  if (!range || !range[1].trim()) return null;
  const lineStart = range[2] ? Number(range[2]) : undefined;
  const lineEnd = range[3] ? Number(range[3]) : lineStart;
  if (lineStart !== undefined && lineEnd !== undefined && lineEnd < lineStart) return null;
  return { id, original, path: range[1], ...(lineStart ? { lineStart } : {}), ...(lineEnd ? { lineEnd } : {}) };
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
  else out.push({ kind: "markdown", id: `markdown-${out.length}`, text });
}

/**
 * Splits assistant text into markdown and complete Obsidian-style file embeds.
 * Fenced blocks and inline-code spans are always left untouched.
 */
export function parseMessage(text: string): Segment[] {
  const out: Segment[] = [];
  let inFence: { marker: string; char: string } | null = null;
  let offset = 0;
  let embedIndex = 0;

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
        const parsed = !isInside(spans, start) ? parseEmbed(original, match[1], `embed-${embedIndex++}`) : null;
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
