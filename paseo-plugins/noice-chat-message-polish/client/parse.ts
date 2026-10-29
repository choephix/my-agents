// Pure text → tree logic, no DOM. A user message becomes text runs (rendered as compact Markdown)
// and folds (block tags such as <attachments>…</attachments>, drawn as one fold line each).

export interface FoldRules {
  always: ReadonlySet<string>;
  never: ReadonlySet<string>;
}

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "fold"; tag: string; open: string; close: string; body: string };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const OPEN = /^ {0,3}<([A-Za-z][\w.:-]*)((?:\s[^<>]*?)?)>(.*)$/;

/** Tracks whether a line is inside a ``` / ~~~ fence. */
function fenceTracker() {
  let fence: string | null = null;
  return (line: string) => {
    const match = FENCE.exec(line);
    if (!match) return fence !== null;
    const marker = match[1];
    if (fence === null) { fence = marker; return true; }
    if (marker[0] === fence[0] && marker.length >= fence.length && !line.slice(match[0].length).trim()) fence = null;
    return true;
  };
}

/**
 * Splits a message into text and folds. A block folds when its opening tag starts a line, a
 * matching closing tag ends a later (or the same) line, and it is not inside a code fence. It
 * folds when the content has 2+ lines or the tag is in `always`; tags in `never` never fold.
 * Same-name tags nested inside are skipped over, so the outermost block is one fold.
 */
export function segment(text: string, rules: FoldRules): Segment[] {
  const lines = text.split("\n");
  const segments: Segment[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) segments.push({ kind: "text", text: run.join("\n") });
    run = [];
  };
  const inFence = fenceTracker();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFence(line)) { run.push(line); continue; }
    const fold = foldAt(lines, i, rules);
    if (!fold) { run.push(line); continue; }
    flush();
    segments.push(fold.segment);
    i = fold.end;
  }
  flush();
  return segments;
}

function foldAt(lines: string[], start: number, rules: FoldRules): { segment: Segment; end: number } | null {
  const open = OPEN.exec(lines[start]);
  if (!open || open[2].endsWith("/")) return null;
  const tag = open[1].toLowerCase();
  if (rules.never.has(tag)) return null;
  const closeAtEnd = new RegExp(`</${escape(open[1])}>\\s*$`, "i");
  const nestedOpen = new RegExp(`^\\s*<${escape(open[1])}(\\s[^<>]*)?>`, "i");
  const openTag = lines[start].slice(0, lines[start].length - open[3].length).trim();
  const rest = open[3];
  let inner: string[] | null = null;
  let end = start;
  let closeTag = "";
  if (closeAtEnd.test(rest)) {
    closeTag = closeAtEnd.exec(rest)![0].trim();
    inner = [rest.replace(closeAtEnd, "")];
  } else {
    const inFence = fenceTracker();
    let depth = 0;
    for (let j = start + 1; j < lines.length; j++) {
      const line = lines[j];
      if (inFence(line)) continue;
      const closes = closeAtEnd.test(line);
      if (nestedOpen.test(line) && !closes && !/\/>\s*$/.test(line)) { depth++; continue; }
      if (!closes) continue;
      if (depth > 0) { depth--; continue; }
      closeTag = closeAtEnd.exec(line)![0].trim();
      inner = [rest, ...lines.slice(start + 1, j), line.replace(closeAtEnd, "")];
      end = j;
      break;
    }
  }
  if (!inner) return null;
  while (inner.length && !inner[0].trim()) inner.shift();
  while (inner.length && !inner[inner.length - 1].trim()) inner.pop();
  if (inner.length < 2 && !rules.always.has(tag)) return null;
  const body = inner.join("\n");
  return { segment: { kind: "fold", tag: open[1], open: openTag, close: closeTag, body }, end };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------------------------
// Compact Markdown: the subset people type in chat. Single newlines stay line breaks, as in
// Paseo's plain rendering. Anything not recognised stays literal text.

export type Inline =
  | { t: "text"; text: string }
  | { t: "code"; text: string }
  | { t: "strong" | "em" | "del"; children: Inline[] }
  | { t: "link"; href: string; children: Inline[] };

export type Block =
  | { t: "p"; inline: Inline[] }
  | { t: "h"; level: number; inline: Inline[] }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; blocks: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "hr" };

const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;

export function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const close = FENCE.exec(lines[j]);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length && !lines[j].slice(close[0].length).trim()) break;
        body.push(lines[j]);
      }
      blocks.push({ t: "code", lang: line.slice(fence[0].length).trim().split(/\s+/)[0] ?? "", text: body.join("\n") });
      i = j + 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ t: "h", level: heading[1].length, inline: parseInline(heading[2]) }); i++; continue; }
    if (HR.test(line)) { blocks.push({ t: "hr" }); i++; continue; }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i])![1]), i++;
      blocks.push({ t: "quote", blocks: parseBlocks(body.join("\n")) });
      continue;
    }
    if (LIST.test(line)) { i = parseList(lines, i, blocks); continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i]), i++;
    blocks.push({ t: "p", inline: parseInline(para.join("\n")) });
  }
  return blocks;
}

const startsBlock = (line: string) => FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST.test(line);

function parseList(lines: string[], start: number, out: Block[]): number {
  const first = LIST.exec(lines[start])!;
  const ordered = /\d/.test(first[2]);
  const indent = first[1].length;
  const items: string[][] = [];
  let i = start;
  while (i < lines.length) {
    const match = LIST.exec(lines[i]);
    if (match && match[1].length === indent && /\d/.test(match[2]) === ordered) {
      items.push([match[3]]);
      i++;
      continue;
    }
    const line = lines[i];
    const lead = line.length - line.trimStart().length;
    // Deeper-indented lines (nested lists, continuations) belong to the current item.
    if (line.trim() && lead > indent) { items[items.length - 1].push(line.slice(Math.min(lead, indent + 2))); i++; continue; }
    // A blank line continues the list only if the next line is another item or indented.
    if (!line.trim() && i + 1 < lines.length && (LIST.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))) {
      const next = LIST.exec(lines[i + 1]);
      if (!next || next[1].length >= indent) { i++; continue; }
    }
    break;
  }
  out.push({ t: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items: items.map((item) => parseBlocks(item.join("\n"))) });
  return i;
}

const INLINE = new RegExp([
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.source, // 1,2 code span
  /\[([^\]\n]+)\]\(([^)\s]+)\)/.source, // 3,4 link
  /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/.source, // 5 bare URL
  String.raw`(\*\*|__)(?=\S)([\s\S]*?\S)\6`, // 6,7 strong (\6: its own group in the joined pattern)
  /~~(?=\S)([\s\S]*?\S)~~/.source, // 8 del
  /\*(?=[^\s*])([\s\S]*?[^\s*])\*/.source, // 9 em with *
  /(?<![\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\w])/.source, // 10 em with _
].join("|"), "g");

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (node: Inline) => {
    const prev = out[out.length - 1];
    if (node.t === "text" && prev?.t === "text") prev.text += node.text;
    else out.push(node);
  };
  for (const match of text.matchAll(INLINE)) {
    const index = match.index!;
    if (index > last) push({ t: "text", text: text.slice(last, index) });
    if (match[2] !== undefined) push({ t: "code", text: match[2].length > 2 && match[2].startsWith(" ") && match[2].endsWith(" ") ? match[2].slice(1, -1) : match[2] });
    else if (match[3] !== undefined) push({ t: "link", href: match[4], children: parseInline(match[3]) });
    else if (match[5] !== undefined) push({ t: "link", href: match[5], children: [{ t: "text", text: match[5] }] });
    else if (match[7] !== undefined) push({ t: "strong", children: parseInline(match[7]) });
    else if (match[8] !== undefined) push({ t: "del", children: parseInline(match[8]) });
    else push({ t: "em", children: parseInline(match[9] ?? match[10]) });
    last = index + match[0].length;
  }
  if (last < text.length) push({ t: "text", text: text.slice(last) });
  return out;
}

/** True when rendering would look exactly like Paseo's plain text, so the bubble can stay untouched. */
export function isPlain(blocks: Block[]): boolean {
  return blocks.every((block) => block.t === "p" && block.inline.every((node) => node.t === "text"));
}
