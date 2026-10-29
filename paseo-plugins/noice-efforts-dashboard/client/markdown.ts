/**
 * The Markdown subset model answers use, parsed for React Native rendering
 * (the plugin SDK exposes no Markdown component): headings, paragraphs, bullet
 * and numbered lists, block quotes, fenced code, tables, rules; inline bold,
 * italic, strikethrough, code and links. Anything else stays literal text.
 */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  url?: string;
}

export type Block =
  | { type: "heading"; level: number; spans: Span[] }
  | { type: "paragraph"; spans: Span[] }
  | { type: "item"; marker: string; depth: number; spans: Span[] }
  | { type: "quote"; spans: Span[] }
  | { type: "code"; text: string }
  | { type: "table"; header: Span[][]; rows: Span[][][] }
  | { type: "rule" };

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function tableCells(line: string): Span[][] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map(cell => parseInline(cell.trim()));
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", spans: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      flush();
      const header = tableCells(line);
      const rows: Span[][][] = [];
      for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++) rows.push(tableCells(lines[i]));
      i--;
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      flush();
      const bullet = /^[-*+]$/.test(item[2]);
      const depth = Math.floor(item[1].replace(/\t/g, "  ").length / 2);
      blocks.push({ type: "item", marker: bullet ? "•" : item[2].replace(")", "."), depth, spans: parseInline(item[3]) });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const previous = blocks.at(-1);
      if (previous?.type === "quote") appendSpans(previous.spans, parseInline(` ${quote[1]}`));
      else blocks.push({ type: "quote", spans: parseInline(quote[1]) });
      continue;
    }
    // A wrapped list item continues on an indented line.
    const previous = blocks.at(-1);
    if (!paragraph.length && previous?.type === "item" && /^\s+\S/.test(line)) {
      appendSpans(previous.spans, parseInline(` ${line.trim()}`));
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

type Style = Omit<Span, "text">;

/** Delimited runs, tried in order at each position. Code first: its content is literal. */
const INLINE_RULES: { open: string; close: string; style: keyof Style }[] = [
  { open: "**", close: "**", style: "bold" },
  { open: "__", close: "__", style: "bold" },
  { open: "~~", close: "~~", style: "strike" },
  { open: "*", close: "*", style: "italic" },
  { open: "_", close: "_", style: "italic" },
];

export function parseInline(text: string, style: Style = {}): Span[] {
  const spans: Span[] = [];
  let plain = "";
  const flushPlain = () => {
    if (plain) appendSpans(spans, [{ ...style, text: plain }]);
    plain = "";
  };

  let i = 0;
  outer: while (i < text.length) {
    const rest = text.slice(i);
    const code = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest);
    if (code) {
      flushPlain();
      appendSpans(spans, [{ ...style, code: true, text: code[2].replace(/^ (.*) $/, "$1") }]);
      i += code[0].length;
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      flushPlain();
      appendSpans(spans, parseInline(link[1], { ...style, url: link[2] }));
      i += link[0].length;
      continue;
    }
    const url = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/.exec(rest);
    if (url && !/\w$/.test(plain)) {
      flushPlain();
      appendSpans(spans, [{ ...style, url: url[0], text: url[0] }]);
      i += url[0].length;
      continue;
    }
    for (const rule of INLINE_RULES) {
      if (!rest.startsWith(rule.open) || style[rule.style]) continue;
      // Intraword underscores (snake_case) are literal; the run must hug its content.
      if (rule.open[0] === "_" && /\w$/.test(plain)) continue;
      const after = rest.slice(rule.open.length);
      if (!after || /^\s/.test(after)) continue;
      const end = findClose(after, rule.close);
      if (end <= 0) continue;
      flushPlain();
      appendSpans(spans, parseInline(after.slice(0, end), { ...style, [rule.style]: true }));
      i += rule.open.length + end + rule.close.length;
      continue outer;
    }
    plain += text[i];
    i++;
  }
  flushPlain();
  return spans;
}

/** Index of the closing delimiter that ends a run, skipping code spans; -1 if none. */
function findClose(text: string, close: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) i = end;
      continue;
    }
    if (!text.startsWith(close, i) || /\s/.test(text[i - 1] ?? " ")) continue;
    // `**` must not close a single-`*` run, and vice versa.
    if (close.length === 1 && text[i + 1] === close) {
      i++;
      continue;
    }
    if (close[0] === "_" && /\w/.test(text[i + close.length] ?? "")) continue;
    return i;
  }
  return -1;
}

/** Appends spans, merging neighbours of the same style and dropping empty ones. */
function appendSpans(target: Span[], more: Span[]): void {
  for (const span of more) {
    if (!span.text) continue;
    const last = target.at(-1);
    if (last && sameStyle(last, span)) last.text += span.text;
    else target.push(span);
  }
}

function sameStyle(a: Span, b: Span): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.strike === !!b.strike &&
    !!a.code === !!b.code &&
    a.url === b.url
  );
}

/** The answer as one line of plain text, for a collapsed answer's preview. */
export function plainText(source: string): string {
  return parseMarkdown(source)
    .map(block => {
      switch (block.type) {
        case "code":
          return block.text;
        case "table":
          return [block.header, ...block.rows].map(row => row.map(cell => cell.map(span => span.text).join("")).join(" ")).join(" ");
        case "rule":
          return "";
        case "item":
          return `${block.marker} ${block.spans.map(span => span.text).join("")}`;
        default:
          return block.spans.map(span => span.text).join("");
      }
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
