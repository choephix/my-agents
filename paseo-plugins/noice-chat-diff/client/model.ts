// Pure diff detection, parsing and tokenizing. No DOM, no React: offsets index the code block's text.

export type TokenKind =
  | "keyword"
  | "comment"
  | "string"
  | "number"
  | "literal"
  | "function"
  | "type"
  | "tag"
  | "attribute"
  | "property"
  | "operator"
  | "addSign"
  | "delSign"
  | "header"
  | "hunk";

export type LineKind = "add" | "del" | "ctx" | "header" | "hunk" | "note";

/** The changed words inside a paired removed/added line, painted as a stronger row tint. */
export type EditKind = "delEdit" | "addEdit";

export interface Span<Kind extends string = TokenKind> {
  start: number;
  end: number;
  kind: Kind;
}

export interface DiffLine {
  start: number;
  end: number;
  kind: LineKind;
}

export interface DiffModel {
  lines: DiffLine[];
  spans: Span[];
  edits: Array<Span<EditKind>>;
}

/** Paseo stops syntax-highlighting code blocks past this size; rows and signs still color. */
const MAX_SYNTAX_CHARS = 100_000;

const DIFF_FENCES: Record<string, true> = { diff: true, patch: true, udiff: true };

/**
 * Whether a fenced block is a diff. Labeled `diff`/`patch` fences always are. Unlabeled fences need
 * git structure (`@@ -1`, `diff --git`, a `---`/`+++` pair) or every line shaped like a diff row with
 * at least one addition and one removal. Fences labeled with any other language are left alone.
 */
export function isDiffBlock(language: string | null, text: string): boolean {
  const lang = (language ?? "").trim().split(/\s+/)[0]!.toLowerCase();
  if (DIFF_FENCES[lang] === true) return true;
  if (lang) return false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^@@ -\d/.test(line) || line.startsWith("diff --git ")) return true;
    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) return true;
  }
  let adds = 0;
  let dels = 0;
  for (const line of lines) {
    if (line === "") continue;
    if (line[0] === "+") adds++;
    else if (line[0] === "-") dels++;
    else if (line[0] !== " ") return false;
  }
  return adds > 0 && dels > 0;
}

// ---------------------------------------------------------------- languages

interface Lang {
  lineComments: string[];
  /** `#` comments only at a word boundary (shell, YAML), so `$#` and `a#b` stay code. */
  hashAtWordStart?: boolean;
  blockComments: Array<[string, string]>;
  quotes: string;
  keywords: Record<string, true>;
  literals: Record<string, true>;
  /** PascalCase identifiers are types. */
  pascalTypes?: boolean;
  /** `<tag attr=...>` markup. */
  tags?: boolean;
  /** `key:` (YAML) or `key =` (TOML/INI) at line start is a property. */
  lineKeys?: ":" | "=";
  /** `"key":` strings are properties (JSON). */
  jsonKeys?: boolean;
}

const words = (s: string) => Object.fromEntries(s.split(" ").map((w) => [w, true])) as Record<string, true>;

const C_KEYWORDS = words(
  "abstract as async await break case catch class const continue debugger declare def default defer delete do else enum export extends final finally fn for from func function go goto if impl implements import in instanceof interface internal let loop match mod module move mut namespace new of operator override package private protected pub public readonly return satisfies sealed select static struct super switch throw throws trait try type typeof unsafe use using var virtual void where while with yield chan map range fallthrough val fun object when is lateinit sizeof typedef union extern register volatile inline",
);
const C_LITERALS = words("true false null undefined nil None True False this self Self NaN Infinity iota");
const PY_KEYWORDS = words(
  "and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield",
);
const SH_KEYWORDS = words(
  "if then else elif fi for in do done while until case esac function return export local readonly declare set unset source alias exit shift trap eval exec sudo echo cd",
);
const RUBY_KEYWORDS = words(
  "alias and begin break case class def defined do else elsif end ensure for if in module next not or redo rescue retry return super then undef unless until when while yield require require_relative attr_accessor attr_reader private protected public",
);
const SQL_KEYWORDS = words(
  "select from where and or not insert into values update set delete create table index view drop alter add column primary key foreign references join left right inner outer full on group by order having limit offset as distinct union all case when then else end is null like in exists between returning with default constraint unique begin commit rollback transaction SELECT FROM WHERE AND OR NOT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE INDEX VIEW DROP ALTER ADD COLUMN PRIMARY KEY FOREIGN REFERENCES JOIN LEFT RIGHT INNER OUTER FULL ON GROUP BY ORDER HAVING LIMIT OFFSET AS DISTINCT UNION ALL CASE WHEN THEN ELSE END IS NULL LIKE IN EXISTS BETWEEN RETURNING WITH DEFAULT CONSTRAINT UNIQUE BEGIN COMMIT ROLLBACK TRANSACTION",
);
const LUA_KEYWORDS = words("and break do else elseif end for function goto if in local not or repeat return then until while");
const NONE: Record<string, true> = {};

const C_LIKE: Lang = {
  lineComments: ["//"],
  blockComments: [["/*", "*/"]],
  quotes: "\"'`",
  keywords: C_KEYWORDS,
  literals: C_LITERALS,
  pascalTypes: true,
};
const LANGS = {
  c: C_LIKE,
  jsx: { ...C_LIKE, tags: true },
  python: { lineComments: ["#"], blockComments: [], quotes: "\"'", keywords: PY_KEYWORDS, literals: C_LITERALS, pascalTypes: true },
  ruby: { lineComments: ["#"], blockComments: [], quotes: "\"'", keywords: RUBY_KEYWORDS, literals: C_LITERALS, pascalTypes: true },
  shell: { lineComments: ["#"], hashAtWordStart: true, blockComments: [], quotes: "\"'", keywords: SH_KEYWORDS, literals: words("true false") },
  yaml: { lineComments: ["#"], hashAtWordStart: true, blockComments: [], quotes: "\"'", keywords: NONE, literals: words("true false null yes no on off ~"), lineKeys: ":" },
  toml: { lineComments: ["#", ";"], blockComments: [], quotes: "\"'", keywords: NONE, literals: words("true false"), lineKeys: "=" },
  json: { lineComments: ["//"], blockComments: [["/*", "*/"]], quotes: "\"", keywords: NONE, literals: words("true false null"), jsonKeys: true },
  css: { lineComments: ["//"], blockComments: [["/*", "*/"]], quotes: "\"'", keywords: words("important media import supports keyframes from to and not only"), literals: NONE },
  markup: { lineComments: [], blockComments: [["<!--", "-->"]], quotes: "\"'", keywords: NONE, literals: NONE, tags: true },
  sql: { lineComments: ["--"], blockComments: [["/*", "*/"]], quotes: "'\"", keywords: SQL_KEYWORDS, literals: words("true false TRUE FALSE NULL null") },
  lua: { lineComments: ["--"], blockComments: [], quotes: "\"'", keywords: LUA_KEYWORDS, literals: words("true false nil self") },
} satisfies Record<string, Lang>;
export type LangId = keyof typeof LANGS;

const EXTENSIONS: Record<string, LangId> = {};
const register = (id: LangId, exts: string) => exts.split(" ").forEach((e) => (EXTENSIONS[e] = id));
register("c", "js mjs cjs ts mts cts java c h cc cpp cxx hpp hh cs go rs swift kt kts scala dart php groovy gradle zig sol proto m mm v glsl hlsl wgsl");
register("jsx", "jsx tsx");
register("python", "py pyi pyw");
register("ruby", "rb rake gemspec");
register("shell", "sh bash zsh fish ps1 bats envrc env dockerfile makefile mk nix ex exs r");
register("yaml", "yml yaml");
register("toml", "toml ini cfg conf properties");
register("json", "json jsonc json5 jsonl");
register("css", "css scss less sass");
register("markup", "html htm xml svg vue svelte astro xhtml plist");
register("sql", "sql");
register("lua", "lua hs elm");
// Markdown and text files are prose: no syntax colors, so changed words stand out.

/** Language for a file path from a diff header, or undefined when the extension is unknown. */
export function langFromPath(path: string): LangId | undefined {
  const name = path.trim().split(/[\\/]/).pop()!.toLowerCase();
  const special = name === "dockerfile" || name === "makefile" || name.startsWith(".env") ? "shell" : undefined;
  if (special) return special;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? EXTENSIONS[name.slice(dot + 1)] : undefined;
}

/** Guess for diffs without a file header. C-like is a fair default for most mock diffs. */
export function sniffLang(code: string): LangId {
  if (/^\s*(def |elif |from \S+ import |import \w+$|class \w+(\(.*\))?:$)/m.test(code)) return "python";
  if (/^\s*(#!\/|\$ |(sudo|export|echo|cd|npm|pnpm|git|paseo) )/m.test(code)) return "shell";
  if (/^\s*<\/?[A-Za-z][\w.-]*[\s>]/m.test(code) && !/[;{]\s*$/m.test(code)) return "markup";
  if (/^\s*[\w-]+:(\s|$)/m.test(code) && !/[;{}()]/.test(code)) return "yaml";
  if (/^\s*"[^"]+"\s*:/m.test(code)) return "json";
  return /<[A-Z][\w.]*[\s/>]/.test(code) ? "jsx" : "c";
}

// ---------------------------------------------------------------- tokenizer

/** Carries an open block comment from one line to the next on the same side of the diff. */
export interface TokenState {
  blockEnd?: string;
}

const IDENT = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z]*/y;
const OPERATOR = /[=+\-*/<>!&|?:%^~]+/y;

/** Appends spans for `line` (whose first char sits at `base` in the block text). */
export function tokenizeLine(lang: Lang, line: string, base: number, state: TokenState, out: Span[]): void {
  const push = (start: number, end: number, kind: TokenKind) => {
    if (end > start) out.push({ start: base + start, end: base + end, kind });
  };
  let i = 0;
  if (state.blockEnd) {
    const close = line.indexOf(state.blockEnd);
    if (close < 0) return push(0, line.length, "comment");
    push(0, close + state.blockEnd.length, "comment");
    i = close + state.blockEnd.length;
    state.blockEnd = undefined;
  }
  if (lang.lineKeys && i === 0) {
    const key = lang.lineKeys === ":" ? /^(\s*(?:-\s+)?)([\w.-]+|"[^"]*"|'[^']*')(?=\s*:(\s|$))/.exec(line) : /^(\s*)([\w.-]+|"[^"]*")(?=\s*=)/.exec(line);
    if (key) {
      push(key[1]!.length, key[0].length, "property");
      i = key[0].length;
    } else if (lang.lineKeys === "=" && /^\s*\[.*\]\s*$/.test(line)) {
      return push(0, line.length, "type");
    }
  }
  let inTag = false;
  while (i < line.length) {
    const ch = line[i]!;
    const lineComment = lang.lineComments.find((c) => line.startsWith(c, i));
    if (lineComment && (!lang.hashAtWordStart || lineComment !== "#" || i === 0 || /\s/.test(line[i - 1]!))) {
      return push(i, line.length, "comment");
    }
    const block = lang.blockComments.find(([open]) => line.startsWith(open, i));
    if (block) {
      const close = line.indexOf(block[1], i + block[0].length);
      if (close < 0) {
        state.blockEnd = block[1];
        return push(i, line.length, "comment");
      }
      push(i, close + block[1].length, "comment");
      i = close + block[1].length;
      continue;
    }
    if (lang.quotes.includes(ch)) {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
      const end = Math.min(j + 1, line.length);
      push(i, end, lang.jsonKeys && /^\s*:/.test(line.slice(end)) ? "property" : "string");
      i = end;
      continue;
    }
    if (lang.tags && ch === "<" && /^<\/?[A-Za-z]/.test(line.slice(i, i + 3))) {
      const name = /^<\/?([A-Za-z][\w.:-]*)/.exec(line.slice(i))!;
      push(i + name[0].length - name[1]!.length, i + name[0].length, "tag");
      i += name[0].length;
      inTag = true;
      continue;
    }
    if (inTag && ch === ">") {
      inTag = false;
      i++;
      continue;
    }
    if (/\d/.test(ch) && (i === 0 || !/[\w$]/.test(line[i - 1]!))) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(line);
      if (m) {
        push(i, i + m[0].length, "number");
        i += m[0].length;
        continue;
      }
    }
    IDENT.lastIndex = i;
    const ident = /[A-Za-z_$]/.test(ch) ? IDENT.exec(line) : null;
    if (ident) {
      const word = ident[0];
      const end = i + word.length;
      const prev = line.slice(0, i).trimEnd();
      let kind: TokenKind | undefined;
      if (inTag && /^\s*=/.test(line.slice(end))) kind = "attribute";
      else if (lang.keywords[word] === true && !prev.endsWith(".")) kind = "keyword";
      else if (lang.literals[word] === true) kind = "literal";
      else if (/^\s*\(/.test(line.slice(end))) kind = "function";
      else if (prev.endsWith(".") && !prev.endsWith("..") && lang.pascalTypes) kind = "property";
      else if (lang.pascalTypes && /^[A-Z][a-z0-9]\w*$/.test(word)) kind = "type";
      if (kind) push(i, end, kind);
      i = end;
      continue;
    }
    OPERATOR.lastIndex = i;
    const op = OPERATOR.exec(line);
    if (op) {
      push(i, i + op[0].length, "operator");
      i += op[0].length;
      continue;
    }
    i++;
  }
}

// ---------------------------------------------------------------- diff parsing

const FILE_META = /^(diff --git |index [0-9a-f]+\.\.[0-9a-f]+|(new|deleted) file mode |old mode |new mode |similarity index |dissimilarity index |rename (from|to) |copy (from|to) |Binary files |\*\*\* (Begin|End) Patch|Index: |={3,}$)/;
const PATCH_FILE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/;

function headerPath(line: string): string | undefined {
  const git = /^diff --git a\/(\S+) b\/(\S+)/.exec(line);
  if (git) return git[2];
  const patch = PATCH_FILE.exec(line);
  if (patch) return patch[1];
  const index = /^Index: (.+)$/.exec(line);
  if (index) return index[1];
  const unified = /^(?:---|\+\+\+) (?:[ab]\/)?([^\t]+?)(?:\t.*)?$/.exec(line);
  if (unified && unified[1] !== "/dev/null") return unified[1];
  return undefined;
}

/** Classifies each line of a diff block and colors its code by the file's language. */
export function parseDiff(text: string): DiffModel {
  const rows = text.split("\n");
  const kinds: LineKind[] = rows.map((line, i) => {
    if (FILE_META.test(line) || PATCH_FILE.test(line)) return "header";
    if (line.startsWith("--- ") && rows[i + 1]?.startsWith("+++ ")) return "header";
    if (line.startsWith("+++ ") && rows[i - 1]?.startsWith("--- ")) return "header";
    if (line.startsWith("@@")) return "hunk";
    if (line.startsWith("\\ ")) return "note";
    if (line[0] === "+") return "add";
    if (line[0] === "-") return "del";
    return "ctx";
  });

  // A diff that names its files colors each file by extension (unknown extensions stay plain);
  // a headerless mock diff is sniffed once from its code.
  const named = rows.some((line, i) => kinds[i] === "header" && headerPath(line) !== undefined);
  const highlightSyntax = text.length <= MAX_SYNTAX_CHARS;
  const code = highlightSyntax && !named ? rows.filter((_, i) => kinds[i] !== "header" && kinds[i] !== "hunk").map((l) => l.slice(1)) : [];
  let lang: Lang | undefined = highlightSyntax && !named ? LANGS[sniffLang(code.join("\n"))] : undefined;
  let oldState: TokenState = {};
  let newState: TokenState = {};
  const tokenize = (body: string, at: number, state: TokenState) => {
    if (lang && (state.blockEnd || !isProse(lang, body))) tokenizeLine(lang, body, at, state, spans);
  };

  const lines: DiffLine[] = [];
  const spans: Span[] = [];
  let offset = 0;
  rows.forEach((line, i) => {
    const kind = kinds[i]!;
    const start = offset;
    offset += line.length + 1;
    lines.push({ start, end: start + line.length, kind });
    if (kind === "header") {
      const path = headerPath(line);
      if (path) {
        const next = highlightSyntax ? langFromPath(path) : undefined;
        lang = next ? LANGS[next] : undefined;
        oldState = {};
        newState = {};
      }
      spans.push({ start, end: start + line.length, kind: "header" });
      return;
    }
    if (kind === "hunk") {
      const close = line.indexOf("@@", 2);
      const end = close < 0 ? line.length : close + 2;
      spans.push({ start, end: start + end, kind: "hunk" });
      if (end < line.length) tokenize(line.slice(end), start + end, {});
      oldState = {};
      newState = {};
      return;
    }
    if (kind === "note") {
      spans.push({ start, end: start + line.length, kind: "header" });
      return;
    }
    if (kind === "add" || kind === "del") {
      spans.push({ start, end: start + 1, kind: kind === "add" ? "addSign" : "delSign" });
      tokenize(line.slice(1), start + 1, kind === "add" ? newState : oldState);
      return;
    }
    const body = line.startsWith(" ") ? 1 : 0;
    tokenize(line.slice(body), start + body, newState);
    oldState = { ...newState };
  });
  return { lines, spans, edits: wordEdits(text, lines) };
}

/**
 * Whether a line reads as prose (a sentence in a prompt, docs or a message) rather than code, so
 * code colors would only paint English words like `from` and `in` as keywords. Comments keep their
 * comment color.
 */
function isProse(lang: Lang, body: string): boolean {
  const text = body.trim();
  if (/[;{}=<>|&]|\($/.test(text) || /^(\/[/*]|\*|--)/.test(text) || lang.lineComments.some((c) => text.startsWith(c))) return false;
  let plain = 0;
  let plainChars = 0;
  let keywords = 0;
  for (const word of text.match(/[\p{L}\p{N}_$'’]+/gu) ?? []) {
    if (!/^\p{L}[\p{Ll}'’]*$/u.test(word)) continue;
    plain++;
    plainChars += word.length;
    if (lang.keywords[word] === true || lang.literals[word] === true) keywords++;
  }
  // Mostly ordinary words, few of them keywords: `return x if y is not None else z` is code.
  return plain >= 6 && plainChars >= text.replace(/\s/g, "").length * 0.7 && keywords * 3 < plain;
}

/** Words, whitespace runs and single symbols: the units a changed range is made of. */
const TOKEN = /[\p{L}\p{N}_$]+|\s+|[^\p{L}\p{N}_$\s]/gu;
/** How far ahead in a run of additions a removal looks for its counterpart. */
const PAIR_WINDOW = 8;
/** Share of their text two lines must have in common to pair; less is a rewrite, left unmarked. */
const PAIR_SIMILARITY = 0.5;
/** Larger differing middles (token count × token count) get one changed range instead of a word diff. */
const MAX_DIFF_CELLS = 250_000;
/** A pair whose marks would cover more than this share of both lines is a rewrite after all. */
const MAX_MARKED_SHARE = 0.8;

interface Tokens {
  text: string;
  list: string[];
  /** Start offset of each token, plus the text length at the end. */
  starts: number[];
  /** Characters per non-space token, for similarity. */
  counts: Map<string, number>;
  size: number;
}

function lineTokens(text: string): Tokens {
  const list = text.match(TOKEN) ?? [];
  const starts: number[] = [];
  const counts = new Map<string, number>();
  let at = 0;
  let size = 0;
  for (const token of list) {
    starts.push(at);
    at += token.length;
    if (token.trim()) {
      counts.set(token, (counts.get(token) ?? 0) + token.length);
      size += token.length;
    }
  }
  starts.push(at);
  return { text, list, starts, counts, size };
}

/** Dice coefficient over the characters of the lines' words and symbols, ignoring order and spacing. */
function similarity(a: Tokens, b: Tokens): number {
  if (a.size + b.size === 0) return 1;
  let common = 0;
  for (const [token, chars] of a.counts) common += Math.min(chars, b.counts.get(token) ?? 0);
  return (2 * common) / (a.size + b.size);
}

/**
 * Changed words of removed/added lines that pair up, as GitHub and delta mark them. In each run of
 * removals followed by additions, every removal pairs, in order, with the most similar of the next
 * few additions; a word-level diff of the pair then marks every changed range on both sides.
 * Rewritten lines stay unpaired, since marking most of a line only repeats the row color.
 */
function wordEdits(text: string, lines: DiffLine[]): Array<Span<EditKind>> {
  const edits: Array<Span<EditKind>> = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i]!.kind !== "del") {
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    while (lines[i]?.kind === "del") dels.push(lines[i++]!);
    const adds: DiffLine[] = [];
    while (lines[i]?.kind === "add") adds.push(lines[i++]!);
    // Bodies after the +/- sign.
    const addTokens = adds.map((add) => lineTokens(text.slice(add.start + 1, add.end)));
    let next = 0;
    for (const del of dels) {
      const a = lineTokens(text.slice(del.start + 1, del.end));
      let best = -1;
      let bestScore = PAIR_SIMILARITY;
      for (let k = next; k < Math.min(adds.length, next + PAIR_WINDOW); k++) {
        const score = similarity(a, addTokens[k]!);
        if (score >= bestScore && (best < 0 || score > bestScore)) {
          best = k;
          bestScore = score;
        }
      }
      if (best < 0) continue;
      next = best + 1;
      const add = adds[best]!;
      const b = addTokens[best]!;
      const groups = changedGroups(a, b);
      if (markedShare(a.text, groups.map((g) => [g.aStart, g.aEnd])) > MAX_MARKED_SHARE && markedShare(b.text, groups.map((g) => [g.bStart, g.bEnd])) > MAX_MARKED_SHARE) continue;
      for (const group of groups) {
        pushEdit(edits, a.text, del.start + 1, group.aStart, group.aEnd, "delEdit");
        pushEdit(edits, b.text, add.start + 1, group.bStart, group.bEnd, "addEdit");
      }
    }
  }
  return edits;
}

/** Share of a line's non-space characters inside the given ranges. */
function markedShare(body: string, ranges: Array<[number, number]>): number {
  const total = body.replace(/\s/g, "").length;
  if (total === 0) return 0;
  let marked = 0;
  for (const [start, end] of ranges) marked += body.slice(start, end).replace(/\s/g, "").length;
  return marked / total;
}

/** Adds a changed range without its surrounding spaces; whitespace-only changes (re-indents) stay unmarked. */
function pushEdit(edits: Array<Span<EditKind>>, body: string, base: number, start: number, end: number, kind: EditKind): void {
  while (start < end && /\s/.test(body[start]!)) start++;
  while (end > start && /\s/.test(body[end - 1]!)) end--;
  if (end > start) edits.push({ start: base + start, end: base + end, kind });
}

/** A run of equal text, or a change: characters [aStart, aEnd) of one side became [bStart, bEnd) of the other. */
interface Group {
  equal: boolean;
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

let lcsTable = new Uint16Array(0);

/** Changed ranges of a paired line: a longest-common-subsequence diff over tokens, then cleaned up. */
function changedGroups(a: Tokens, b: Tokens): Group[] {
  const x = a.list;
  const y = b.list;
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const n = x.length - head - tail;
  const m = y.length - head - tail;

  // Per token of the middles: whether it is common to both sides.
  const keepA = new Uint8Array(n);
  const keepB = new Uint8Array(m);
  if (n > 0 && m > 0 && n * m <= MAX_DIFF_CELLS) {
    const width = m + 1;
    if (lcsTable.length < (n + 1) * width) lcsTable = new Uint16Array((n + 1) * width);
    const t = lcsTable;
    // t[i][j]: common tokens of x-middle[i..] and y-middle[j..].
    for (let j = 0; j <= m; j++) t[n * width + j] = 0;
    for (let i = n - 1; i >= 0; i--) {
      t[i * width + m] = 0;
      for (let j = m - 1; j >= 0; j--) {
        t[i * width + j] = x[head + i] === y[head + j] ? t[(i + 1) * width + j + 1]! + 1 : Math.max(t[(i + 1) * width + j]!, t[i * width + j + 1]!);
      }
    }
    for (let i = 0, j = 0; i < n && j < m; ) {
      if (x[head + i] === y[head + j]) {
        keepA[i++] = 1;
        keepB[j++] = 1;
      } else if (t[(i + 1) * width + j]! >= t[i * width + j + 1]!) i++;
      else j++;
    }
  }

  // Walk both sides together into alternating equal and changed groups.
  const groups: Group[] = [];
  const push = (equal: boolean, i0: number, i1: number, j0: number, j1: number) => {
    const group = { equal, aStart: a.starts[i0]!, aEnd: a.starts[i1]!, bStart: b.starts[j0]!, bEnd: b.starts[j1]! };
    const last = groups[groups.length - 1];
    if (last && last.equal === equal) {
      last.aEnd = group.aEnd;
      last.bEnd = group.bEnd;
    } else if (group.aEnd > group.aStart || group.bEnd > group.bStart) groups.push(group);
  };
  push(true, 0, head, 0, head);
  for (let i = 0, j = 0; i < n || j < m; ) {
    if (i < n && j < m && keepA[i] && keepB[j]) {
      push(true, head + i, head + i + 1, head + j, head + j + 1);
      i++;
      j++;
      continue;
    }
    const i0 = i;
    const j0 = j;
    while (i < n && !keepA[i]) i++;
    while (j < m && !keepB[j]) j++;
    push(false, head + i0, head + i, head + j0, head + j);
  }
  push(true, x.length - tail, x.length, y.length - tail, y.length);
  slideToWords(groups, a.text, b.text);
  return mergeShortEqualities(groups).filter((group) => !group.equal);
}

const WORD = /[\p{L}\p{N}_$]/u;

/**
 * Slides a pure insertion or deletion past the spaces and punctuation it repeats, so it starts at a
 * word: `polish. When` → `polish. Skip it. When` marks `Skip it.`, not `. Skip it`.
 */
function slideToWords(groups: Group[], a: string, b: string): void {
  for (let k = 1; k < groups.length - 1; k++) {
    const [prev, edit, next] = [groups[k - 1]!, groups[k]!, groups[k + 1]!];
    const insertion = edit.aStart === edit.aEnd;
    if (edit.equal || !prev.equal || !next.equal || (!insertion && edit.bStart !== edit.bEnd)) continue;
    const text = insertion ? b : a;
    const start = insertion ? edit.bStart : edit.aStart;
    const end = insertion ? edit.bEnd : edit.aEnd;
    let shift = 0;
    while (next.aEnd - next.aStart > shift + 1 && text[start + shift] === text[end + shift] && !WORD.test(text[start + shift]!)) shift++;
    prev.aEnd += shift;
    prev.bEnd += shift;
    edit.aStart += shift;
    edit.aEnd += shift;
    edit.bStart += shift;
    edit.bEnd += shift;
    next.aStart += shift;
    next.bStart += shift;
  }
}

/**
 * Folds an equal run into the changes around it when it is no longer than the change on either
 * side, as diff-match-patch's semantic cleanup does: `fooBar(x` → `fooBaz(x, y` reads as one edit,
 * and the spaces and short words a word diff matches by chance stop splitting a rewritten phrase.
 */
function mergeShortEqualities(groups: Group[]): Group[] {
  const span = (g: Group) => Math.max(g.aEnd - g.aStart, g.bEnd - g.bStart);
  for (let k = 1; k < groups.length - 1; ) {
    const [before, equal, after] = [groups[k - 1]!, groups[k]!, groups[k + 1]!];
    if (equal.equal && !before.equal && !after.equal && span(equal) <= span(before) && span(equal) <= span(after)) {
      groups.splice(k - 1, 3, { equal: false, aStart: before.aStart, aEnd: after.aEnd, bStart: before.bStart, bEnd: after.bEnd });
      k = Math.max(1, k - 2);
    } else k++;
  }
  return groups;
}
