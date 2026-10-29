import path from "node:path";

/** One link token found in a message's prose. */
export interface Mention {
  kind: "url" | "path";
  /** The URL as written (trimmed), or an absolute path with `~` expanded and no line suffix. */
  target: string;
  /** A path's line suffix as written: `:12`, `:12-20`, `:12:3`. */
  line?: string;
  /** Markdown link text or image alt. */
  title?: string;
  /** The path was written with a trailing `/`. */
  dirHint?: boolean;
}

export interface ExtractOptions {
  home: string;
  /** Decides paths with spaces and top-level folders (`/btw` is a slash command, `/v1/chat` an API route). */
  exists(file: string): boolean;
}

// WRAPPER and PROSE_RECORD come from noice-past-sessions/server/preview.ts; WRAPPER also takes `_` tags
// (Codex's `<environment_context>`). Hyphenated tags are harness wrappers (`<paseo-system>`,
// `<system-notice>` …); in user text an unclosed one runs to the end.
const WRAPPER = /<([a-z][a-z0-9]*(?:[-_][a-z0-9]+)+)\b[^>]*>(?:[\s\S]*?<\/\1>|[\s\S]*$)/gi;
/** Assistants write about wrappers too; in their text only closed ones are dropped. */
const CLOSED_WRAPPER = /<([a-z][a-z0-9]*(?:[-_][a-z0-9]+)+)\b[^>]*>[\s\S]*?<\/\1>/gi;
/** OMP's /prose distillation leaves tool-call records in replies: `[ran read x.md; recover: artifact://0:3-40]`. */
const PROSE_RECORD = /\[ran [^\]\n]*?; recover: [^\]\n]*\]/g;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** A Markdown link target: `<with spaces>` or a run without spaces (balanced parentheses allowed), then an optional title. */
const TARGET = String.raw`(?:<([^<>\n]+)>|((?:[^\s()<>]|\([^\s()<>]*\))+))(?:\s+"[^"\n]*")?`;
const IMAGE = new RegExp(String.raw`!\[([^\]\n]*)\]\(\s*${TARGET}\s*\)`, "g");
const MD_LINK = new RegExp(String.raw`\[([^\]\n]+)\]\(\s*${TARGET}\s*\)`, "g");
const AUTOLINK = /<((?:https?|file):\/\/[^\s<>]+)>/g;
const CODE_SPAN = /`([^`\n]+)`/g;
const BARE_URL = /\b(?:https?|file):\/\/[^\s<>"'`]+/g;

const URL_ONLY = /^(?:https?|file):\/\/\S+$/;
const PLACEHOLDER = /[<>{}$*…]/;
const EXAMPLE_HOST = /(?:^|\.)example\.(?:com|org|net)$/i;
const LINE_SUFFIX = /:\d+(?:[-:]\d+)?$/;
const GITHUB_LINES = /#L(\d+)(?:-L?(\d+))?$/;
const TRAILING = /[.,;:!?*_'"]+$/;

/** Blanks fenced code blocks; an unclosed fence runs to the end, as in CommonMark. */
export function blankFences(text: string): string {
  let fence: string | null = null;
  return text
    .split("\n")
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (fence === null) {
        if (!marker) return line;
        fence = marker;
        return "";
      }
      const trimmed = line.trim();
      if (marker && trimmed === marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return "";
    })
    .join("\n");
}

/** The text links are taken from: wrappers, OMP tool records and fenced code removed. */
export function proseOf(text: string, role: "user" | "assistant"): string {
  const unwrapped = text.replace(role === "user" ? WRAPPER : CLOSED_WRAPPER, " ");
  return blankFences(unwrapped.replace(PROSE_RECORD, " "));
}

const count = (text: string, char: string) => text.split(char).length - 1;

/** Drops trailing sentence punctuation and a closing bracket that has no opening one. */
export function trimToken(token: string): string {
  let current = token;
  for (;;) {
    let next = current.replace(TRAILING, "");
    if (next.endsWith(")") && count(next, "(") < count(next, ")")) next = next.slice(0, -1);
    if (next.endsWith("]") && count(next, "[") < count(next, "]")) next = next.slice(0, -1);
    if (next === current) return current;
    current = next;
  }
}

/** Link text worth showing: not empty and not just the target again. */
function titleOf(text: string | undefined): string | undefined {
  const title = text?.replace(/`|\*\*/g, "").trim();
  if (!title || /^(?:~?\/|https?:\/\/)/.test(title)) return undefined;
  return title;
}

function urlMention(raw: string, options: ExtractOptions, title?: string): Mention | null {
  const token = trimToken(raw);
  if (token.startsWith("file://")) {
    try {
      return pathMention(decodeURIComponent(new URL(token).pathname), options, title);
    } catch {
      return null;
    }
  }
  if (PLACEHOLDER.test(token)) return null;
  let url: URL;
  try {
    url = new URL(token);
  } catch {
    return null;
  }
  if (!url.hostname || EXAMPLE_HOST.test(url.hostname)) return null;
  return { kind: "url", target: token, ...(title ? { title } : {}) };
}

function pathMention(raw: string, options: ExtractOptions, title?: string): Mention | null {
  let file = trimToken(raw);
  let line: string | undefined;
  const github = GITHUB_LINES.exec(file);
  if (github) {
    line = github[2] ? `:${github[1]}-${github[2]}` : `:${github[1]}`;
    file = file.slice(0, github.index);
  } else {
    const suffix = LINE_SUFFIX.exec(file);
    if (suffix) {
      line = suffix[0];
      file = file.slice(0, suffix.index);
    }
  }
  if (PLACEHOLDER.test(file)) return null;
  if (file.startsWith("~/")) file = options.home + file.slice(1);
  if (!file.startsWith("/")) return null;
  const dirHint = file.endsWith("/");
  file = path.posix.normalize(file).replace(/\/+$/, "");
  if (!file || file === options.home || file === path.posix.dirname(options.home)) return null;
  if (/\s/.test(file) && !options.exists(file)) return null;
  if (!options.exists(`/${file.split("/")[1]}`)) return null;
  return { kind: "path", target: file, ...(line ? { line } : {}), ...(title ? { title } : {}), ...(dirHint ? { dirHint } : {}) };
}

function targetMention(target: string, options: ExtractOptions, title?: string): Mention | null {
  if (/^(?:https?|file):\/\//.test(target)) return urlMention(target, options, title);
  if (!/^~?\//.test(target)) return null;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // Keep the target as written.
  }
  return pathMention(decoded, options, title);
}

/** A mention and where its token sits in the message's prose (`proseOf`), end exclusive. */
export interface Found {
  mention: Mention;
  start: number;
  end: number;
}

/**
 * Links in one message, in token order: image embeds, Markdown links, autolinks, code spans that
 * hold exactly a URL or an absolute/`~/` path, then bare URLs. Each span is used once.
 */
export function findMentions(text: string, role: "user" | "assistant", options: ExtractOptions): { prose: string; found: Found[] } {
  const found: Found[] = [];
  const prose = proseOf(text, role);
  // Taken spans turn into spaces, so offsets in `work` stay offsets in `prose`.
  let work = prose;
  const scan = (pattern: RegExp, take: (match: RegExpExecArray) => Mention | null) => {
    work = work.replace(pattern, (...args: unknown[]) => {
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      const start = args.at(-2) as number;
      const mention = take(match);
      if (mention) found.push({ mention, start, end: start + match[0].length });
      return " ".repeat(match[0].length);
    });
  };
  scan(IMAGE, (m) => targetMention(m[2] ?? m[3] ?? "", options, titleOf(m[1])));
  scan(MD_LINK, (m) => targetMention(m[2] ?? m[3] ?? "", options, titleOf(m[1])));
  scan(AUTOLINK, (m) => urlMention(m[1] ?? "", options));
  scan(CODE_SPAN, (m) => {
    const content = (m[1] ?? "").trim();
    if (URL_ONLY.test(content)) return urlMention(content, options);
    if (/^~?\//.test(content)) return pathMention(content, options);
    return null;
  });
  scan(BARE_URL, (m) => urlMention(m[0], options));
  return { prose, found };
}

export function extractMentions(text: string, role: "user" | "assistant", options: ExtractOptions): Mention[] {
  return findMentions(text, role, options).found.map(({ mention }) => mention);
}
