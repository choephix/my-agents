/** A link token in a message's prose and the words it reads as in a snippet (the link's title). */
export interface Span {
  start: number;
  end: number;
  label: string;
}

/** About how long a snippet gets. */
const SNIPPET_CHARS = 120;
/** At most this much text before the link when the sentence has to be cut. */
const LEAD_CHARS = 40;
/** A sentence with fewer letters than this besides the link (`Screenshots:` + an embed) takes the one before it too. */
const MIN_LETTERS = 12;

/** The target link's label sits between OPEN and CLOSE, every other link's between OTHER and END. */
const OPEN = "\u0001";
const CLOSE = "\u0002";
const OTHER = "\u0003";
const END = "\u0004";
const LABEL = /[\u0001\u0003][^\u0002\u0004]*[\u0002\u0004]/g;
/** Sentence end: `.`, `!` or `?`, maybe a closing quote or bracket, then space. */
const SENTENCE_END = /[.!?]["')\]]?\s+/g;

/** One line of Markdown as plain words. */
function plainLine(line: string): string {
  if (/^\s*\|?\s*:?-{3,}/.test(line)) return "";
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*)+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/\*\*|__|~~|`|\*/g, "")
    .replace(/(^|[\s(])_(?=\S)|(?<=\S)_(?=[\s).,;:!?]|$)/g, "$1");
}

/** Letters of the words around links, not of the links. */
const words = (text: string) => (text.replace(LABEL, "").match(/\p{L}/gu) ?? []).length;

/** The sentence ranges of one line. */
function sentences(line: string): [number, number][] {
  const ranges: [number, number][] = [];
  let start = 0;
  for (const match of line.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    ranges.push([start, end]);
    start = end;
  }
  if (start < line.length) ranges.push([start, line.length]);
  return ranges;
}

/**
 * A short, plain sentence around `spans[target]` in `prose`: Markdown stripped, every link read as its
 * label, cut to about 120 characters around the link. A link that stands alone (an embed on its own
 * line) gets the text after it in the same paragraph (its caption), else the text before it.
 */
export function snippetAt(prose: string, spans: readonly Span[], target: number): string | undefined {
  let marked = "";
  let position = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    marked += prose.slice(position, span.start);
    marked += span === spans[target] ? `${OPEN}${span.label}${CLOSE}` : `${OTHER}${span.label}${END}`;
    position = span.end;
  }
  marked += prose.slice(position);

  const lines = marked.split("\n").map(plainLine);
  const row = lines.findIndex((line) => line.includes(OPEN));
  if (row < 0) return undefined;
  const line = lines[row] ?? "";
  const ranges = sentences(line);
  const at = ranges.findIndex(([, end]) => end > line.indexOf(OPEN));
  const [start, end] = ranges[at] ?? [0, line.length];
  const own = line.slice(start, end);
  const said = words(own);
  const before = () => (at > 0 ? line.slice(...(ranges[at - 1] ?? [0, 0])) : (lines.slice(0, row).findLast((prev) => prev.trim()) ?? ""));
  let text = own;
  if (said === 0) text = line.slice(end).trim() || lines[row + 1]?.trim() || before();
  else if (said < MIN_LETTERS) text = `${before().trim()} ${own}`;
  text = text.replace(/\s+/g, " ").trim();
  if (words(text) < MIN_LETTERS / 2) return undefined;

  if (text.length > SNIPPET_CHARS) {
    const open = text.indexOf(OPEN);
    let from = Math.max(0, open - LEAD_CHARS);
    if (from > 0) from = text.indexOf(" ", from) + 1 || from;
    let to = Math.max(from + SNIPPET_CHARS, text.indexOf(CLOSE) + 1);
    if (to < text.length) to = text.lastIndexOf(" ", to) > text.indexOf(CLOSE) ? text.lastIndexOf(" ", to) : to;
    text = `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
  }
  return text.replace(/[\u0001-\u0004]/g, "");
}
