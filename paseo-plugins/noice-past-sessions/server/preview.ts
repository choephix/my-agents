import { statSync } from "node:fs";
import { open } from "node:fs/promises";

/** Bytes read from the end of a session file for its last reply. */
export const TAIL_BYTES = 64 * 1024;
/** Read first: the last reply and message are nearly always this close to the end. */
const SMALL_TAIL_BYTES = 16 * 1024;
/** Longer previews are pointless: the UI shows at most two lines. */
export const PREVIEW_MAX = 400;

// Hyphenated tags are harness wrappers (`<paseo-system>`, `<system-notice>`, `<agent-response>`,
// `<chat-history-summary>` …), never prose. An unclosed one runs to the end of the text.
const WRAPPER = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b[^>]*>(?:[\s\S]*?<\/\1>|[\s\S]*$)/gi;
// OMP's /prose distillation leaves tool-call records in replies: `[ran read x.md; recover: artifact://0:3-40]`.
const PROSE_RECORD = /\[ran [^\]\n]*?; recover: [^\]\n]*\]/g;

export function stripWrappers(text: string): string {
  return text.replace(WRAPPER, " ").replace(PROSE_RECORD, " ");
}

/** Markdown to one line of plain prose: code blocks, tables' rules and markup removed. */
export function stripMarkdown(text: string): string {
  const withoutFences = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm, " ");
  const lines = withoutFences.split("\n").flatMap((raw) => {
    let line = raw.trim();
    if (/^(?:[-*_]\s*){3,}$/.test(line)) return []; // horizontal rule
    if (/^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?$/.test(line)) return []; // table rule
    if (line.startsWith("|")) {
      line = line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()).filter(Boolean).join(" · ");
    }
    line = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(?:>\s?)+/, "")
      .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "");
    return line ? [line] : [];
  });
  return lines
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/(\*\*|__|~~)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(\S(?:.*?\S)?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w])_(\S(?:.*?\S)?)_(?!\w)/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain, length-capped prose from an assistant message; null when nothing readable is left. */
export function previewText(raw: string): string | null {
  const text = stripMarkdown(stripWrappers(raw));
  if (!text) return null;
  if (text.length <= PREVIEW_MAX) return text;
  const cut = text.slice(0, PREVIEW_MAX);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), PREVIEW_MAX / 2));
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => (part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("\n\n");
}

export interface TailSummary {
  /** The last assistant reply with readable text, as preview prose. */
  reply: string | null;
  /**
   * The newest message's own timestamp (any record's when the tail has no message). Unlike mtime,
   * it ignores tools that touch files and records like `session_exit`, which OMP appends when a
   * terminal running an old session is killed.
   */
  lastActiveAt: string | null;
}

/**
 * Reads a JSONL transcript tail from the end. Works for OMP
 * (`{type:"message", message:{role:"assistant"}}`) and Claude Code
 * (`{type:"assistant", message:{role:"assistant"}}`). When the tail starts mid-file its first
 * line is partial and skipped.
 */
export function summarizeTail(tail: string, startsMidFile: boolean): TailSummary {
  return walkTail(tail, startsMidFile).summary;
}

/** `complete`: the walk found both the reply and a message time, so a longer tail can't differ. */
function walkTail(tail: string, startsMidFile: boolean): { summary: TailSummary; complete: boolean } {
  const lines = tail.split("\n");
  const first = startsMidFile ? 1 : 0;
  let reply: string | null = null;
  let lastMessageAt: string | null = null;
  let lastRecordAt: string | null = null;
  for (let index = lines.length - 1; index >= first && !(reply && lastMessageAt); index -= 1) {
    const line = lines[index]?.trim();
    if (!line?.startsWith("{")) continue;
    let record: { timestamp?: unknown; message?: { role?: unknown; content?: unknown }; isSidechain?: unknown };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const at =
      typeof record.timestamp === "string" && !Number.isNaN(Date.parse(record.timestamp))
        ? new Date(record.timestamp).toISOString()
        : null;
    lastRecordAt ??= at;
    const role = record.message?.role;
    if (record.isSidechain === true || (role !== "assistant" && role !== "user")) continue;
    lastMessageAt ??= at;
    if (!reply && role === "assistant") reply = previewText(textOf(record.message?.content));
  }
  return {
    summary: { reply, lastActiveAt: lastMessageAt ?? lastRecordAt },
    complete: reply !== null && lastMessageAt !== null,
  };
}

export async function readTail(
  file: string,
  size: number,
  bytes = TAIL_BYTES,
): Promise<{ text: string; startsMidFile: boolean }> {
  const start = Math.max(0, size - bytes);
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return { text: buffer.subarray(0, bytesRead).toString("utf8"), startsMidFile: start > 0 };
  } finally {
    await handle.close();
  }
}

/**
 * The 16 KB tail first; the full TAIL_BYTES only when it lacks the reply or a message time. The
 * backward walk stops at the same line either way, so the summary is the same.
 */
async function summarizeFile(file: string, size: number): Promise<TailSummary> {
  if (size > SMALL_TAIL_BYTES) {
    const small = await readTail(file, size, SMALL_TAIL_BYTES);
    const walked = walkTail(small.text, small.startsMidFile);
    if (walked.complete) return walked.summary;
  }
  const tail = await readTail(file, size);
  return summarizeTail(tail.text, tail.startsMidFile);
}

const EMPTY: TailSummary = { reply: null, lastActiveAt: null };

/** Tail summaries per transcript file, re-read only when a file's mtime or size changes. */
export class TailCache {
  readonly #cache = new Map<string, { mtimeMs: number; size: number; summary: TailSummary }>();

  async summary(file: string): Promise<TailSummary> {
    let info;
    try {
      // Synchronous: a local stat is microseconds; an async one is a threadpool round trip.
      info = statSync(file, { throwIfNoEntry: false });
    } catch {
      return EMPTY;
    }
    if (!info) return EMPTY;
    const cached = this.#cache.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.summary;
    let summary = EMPTY;
    try {
      summary = await summarizeFile(file, info.size);
    } catch {
      summary = EMPTY;
    }
    this.#cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, summary });
    return summary;
  }
}
