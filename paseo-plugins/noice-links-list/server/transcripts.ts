import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Prose } from "./links";

/** One transcript line to a user or assistant message's prose; null for everything else. */
export type ProseReader = (line: string) => Prose | null;

export interface Transcript {
  kind: "omp" | "claude" | "codex";
  file: string;
  read: ProseReader;
}

export interface AgentRecord {
  provider: string;
  cwd: string;
  persistence?: { provider: string; sessionId: string; nativeHandle?: string } | null;
}

/** Only lines with a structural text block can hold prose; skips tool output without parsing it. */
const HAS_TEXT = /"type":"(?:text|Text|input_text|output_text)"/;

function parse(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `text` blocks of a content array (or a plain string), joined. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block: unknown) => {
      if (!block || typeof block !== "object") return [];
      const { type, text } = block as { type?: unknown; text?: unknown };
      return (type === "text" || type === "Text") && typeof text === "string" ? [text] : [];
    })
    .join("\n\n");
}

function prose(role: unknown, content: unknown, timestamp: unknown): Prose | null {
  if (role !== "user" && role !== "assistant") return null;
  const text = textOf(content);
  const at = typeof timestamp === "string" ? Date.parse(timestamp) : typeof timestamp === "number" ? timestamp : NaN;
  return text && Number.isFinite(at) ? { role, text, at } : null;
}

/** OMP: `{"type":"message", timestamp, message:{role, content}}`; `toolResult` and other records are skipped. */
export const readOmpLine: ProseReader = (line) => {
  if (!line.startsWith('{"type":"message"') || !HAS_TEXT.test(line)) return null;
  const record = parse(line);
  const message = record?.message as { role?: unknown; content?: unknown } | undefined;
  return message ? prose(message.role, message.content, record?.timestamp) : null;
};

/** Claude Code: `type` user/assistant records; tool results arrive as user records without text. */
function readClaude(line: string, sidechain: boolean): Prose | null {
  if (!HAS_TEXT.test(line) && !line.includes('"content":"')) return null;
  const record = parse(line);
  if (!record || (record.type !== "user" && record.type !== "assistant") || (record.isSidechain === true) !== sidechain || record.isMeta === true) return null;
  const message = record.message as { role?: unknown; content?: unknown } | undefined;
  return message ? prose(message.role, message.content, record.timestamp) : null;
}

/** The main chain of a Claude Code session. */
export const readClaudeLine: ProseReader = (line) => readClaude(line, false);

/** A Claude Code sub-agent transcript, whose records are all `isSidechain`. */
export const readClaudeSubagentLine: ProseReader = (line) => readClaude(line, true);

/** Codex: `item_completed` events of `UserMessage` (what was typed) and `AgentMessage`. */
export const readCodexLine: ProseReader = (line) => {
  if (!line.includes('"item_completed"') || !HAS_TEXT.test(line)) return null;
  const record = parse(line);
  const payload = record?.payload as { type?: unknown; item?: { type?: unknown; content?: unknown } } | undefined;
  if (record?.type !== "event_msg" || payload?.type !== "item_completed") return null;
  const role = payload.item?.type === "UserMessage" ? "user" : payload.item?.type === "AgentMessage" ? "assistant" : null;
  return prose(role, payload.item?.content, record.timestamp);
};

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * A Codex rollout: `~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`, dated (local time) by the
 * UUIDv7 thread id, else `~/.codex/archived_sessions/`. Compressed archives (`.jsonl.zst`) don't count.
 */
async function codexRollout(threadId: string, home: string): Promise<string | null> {
  const suffix = `-${threadId}.jsonl`;
  const ms = Number.parseInt(threadId.replace(/-/g, "").slice(0, 12), 16);
  const folders: string[] = [];
  if (Number.isFinite(ms)) {
    for (const shift of [0, -1, 1]) {
      const day = new Date(ms + shift * 86_400_000);
      const month = String(day.getMonth() + 1).padStart(2, "0");
      folders.push(path.join(home, ".codex", "sessions", String(day.getFullYear()), month, String(day.getDate()).padStart(2, "0")));
    }
  }
  folders.push(path.join(home, ".codex", "archived_sessions"));
  for (const folder of folders) {
    try {
      const name = (await readdir(folder)).find((entry) => entry.endsWith(suffix));
      if (name) return path.join(folder, name);
    } catch {
      // No such folder.
    }
  }
  return null;
}

const codexFiles = new Map<string, string>();

/**
 * The agent's transcript, resolved again on every request (a rewind gives OMP a new file):
 * OMP and its profiles keep the absolute `.jsonl` path as the native handle; Claude Code keeps
 * `~/.claude/projects/<cwd, non-alphanumerics → "-">/<sessionId>.jsonl` (noice-past-sessions `transcriptFile`).
 */
export async function findTranscript(agent: AgentRecord, home: string): Promise<Transcript | null> {
  const persistence = agent.persistence;
  if (!persistence) return null;
  const handle = persistence.nativeHandle;
  if (handle && path.isAbsolute(handle) && handle.endsWith(".jsonl")) {
    return (await isFile(handle)) ? { kind: "omp", file: handle, read: readOmpLine } : null;
  }
  const provider = persistence.provider || agent.provider;
  if (provider === "claude" && persistence.sessionId) {
    const file = path.join(home, ".claude", "projects", agent.cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${persistence.sessionId}.jsonl`);
    return (await isFile(file)) ? { kind: "claude", file, read: readClaudeLine } : null;
  }
  if (provider === "codex" && persistence.sessionId) {
    const known = codexFiles.get(persistence.sessionId);
    const file = known && (await isFile(known)) ? known : await codexRollout(persistence.sessionId, home);
    if (!file) return null;
    codexFiles.set(persistence.sessionId, file);
    return { kind: "codex", file, read: readCodexLine };
  }
  return null;
}
