import { open } from "node:fs/promises";
import type { Branch, Turn } from "../shared/tree";

/**
 * Reads an OMP session file (JSONL) as a tree. Every entry has an `id` and a
 * `parentId`; several branches live in one file. OMP takes the leaf (where the
 * chat continues) from the last line: a `model_usage` entry points at its
 * `activeLeafId` instead. The `session-tree` OMP extension ends every move with
 * a `custom` entry `paseo-session-tree` (see MarkerData) under the new leaf.
 */
export interface Entry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp?: string;
  message?: { role?: string; content?: unknown; id?: unknown; display?: unknown };
  customType?: string;
  data?: unknown;
  summary?: unknown;
  activeLeafId?: unknown;
  content?: unknown;
  display?: unknown;
}

export const MARKER_TYPE = "paseo-session-tree";

/** What the extension records with each move (`.omp/extensions/session-tree/session-tree.ts`). */
export type MarkerData =
  | { v: 1; op: "goto"; kind: string; from: string | null; fork: string | null; requestId: string }
  | { v: 1; op: "summarize"; from: string; fork: string; focus: string; summaryId?: string; requestId: string };

/** Entries that carry conversation; the rest (markers, model usage, pins, settings) is bookkeeping. */
const CONTENT_TYPES = new Set(["message", "custom_message", "branch_summary", "compaction"]);

/**
 * Hidden custom messages (`display: false`) are bookkeeping too: OMP appends one such as
 * `eval-state-context` whenever a session is reloaded, i.e. right after every move.
 */
function isContent(entry: Entry): boolean {
  return CONTENT_TYPES.has(entry.type) && !(entry.type === "custom_message" && entry.display === false);
}

/** Entry types Paseo's OMP replay hides (`history.js` isControlEntryType). */
const CONTROL_TYPES = new Set([
  "session", "session_init", "system", "title", "title_change", "custom", "system_prompt", "model_change",
  "thinking_level_change", "ttsr_injection", "tool_execution",
]);

export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap(block => (block && typeof block === "object" && block.type === "text" && typeof block.text === "string" ? [block.text] : [])).join("\n\n");
}

function oneLine(text: string, max = 140): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function time(entry: Entry | undefined): number | null {
  const value = entry?.timestamp ? Date.parse(entry.timestamp) : NaN;
  return Number.isFinite(value) ? value : null;
}

/** Reads complete lines only: a writer may be mid-line at the end. */
export async function readEntries(file: string): Promise<{ lines: string[]; entries: Entry[] }> {
  const handle = await open(file, "r");
  let bytes: Buffer;
  try {
    const { size } = await handle.stat();
    bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    bytes = bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
  const end = bytes.lastIndexOf(10);
  const lines = end < 0 ? [] : bytes.subarray(0, end).toString("utf8").split("\n").filter(line => line.trim());
  const entries: Entry[] = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && typeof value.id === "string" && typeof value.type === "string") {
        entries.push({ ...value, parentId: typeof value.parentId === "string" ? value.parentId : null });
      }
    } catch {
      // Not ours to judge; OMP skips such lines too.
    }
  }
  return { lines, entries };
}

export function isMarker(entry: Entry | undefined): entry is Entry & { data: MarkerData } {
  const data = entry?.data;
  return entry?.type === "custom" && entry.customType === MARKER_TYPE && !!data && typeof data === "object" && "op" in data;
}

export class SessionTree {
  readonly byId = new Map<string, Entry>();
  readonly order = new Map<string, number>();
  readonly children = new Map<string, Entry[]>();
  /** OMP's current leaf: the last line, or a model_usage entry's activeLeafId. */
  readonly leafId: string | null;
  /** Message entries by their nearest message ancestor ("" = none). */
  readonly #messageChildren = new Map<string, string[]>();
  readonly #nearest = new Map<string, string | null>();

  constructor(readonly entries: Entry[]) {
    entries.forEach((entry, index) => {
      this.byId.set(entry.id, entry);
      this.order.set(entry.id, index);
      if (entry.parentId) {
        const list = this.children.get(entry.parentId) ?? [];
        list.push(entry);
        this.children.set(entry.parentId, list);
      }
    });
    const last = entries.at(-1);
    this.leafId = last ? (last.type === "model_usage" && typeof last.activeLeafId === "string" ? last.activeLeafId : last.id) : null;
    for (const entry of entries) {
      if (!this.isMessage(entry)) continue;
      const key = this.nearestMessage(entry.parentId) ?? "";
      const list = this.#messageChildren.get(key) ?? [];
      list.push(entry.id);
      this.#messageChildren.set(key, list);
    }
  }

  /** Nodes of the condensed message tree: anything a user sees as a message. */
  isMessage(entry: Entry | undefined): boolean {
    return entry?.type === "message" || (entry?.type === "custom_message" && entry.display !== false);
  }

  /** The entry itself if it is a message, else its nearest message ancestor. */
  nearestMessage(id: string | null): string | null {
    if (!id) return null;
    const cached = this.#nearest.get(id);
    if (cached !== undefined) return cached;
    const path: string[] = [];
    let current: string | null = id;
    let found: string | null = null;
    while (current) {
      const known = this.#nearest.get(current);
      if (known !== undefined) {
        found = known;
        break;
      }
      const entry = this.byId.get(current);
      if (!entry) break;
      path.push(current);
      if (this.isMessage(entry)) {
        found = current;
        break;
      }
      current = entry.parentId;
    }
    for (const step of path) this.#nearest.set(step, found);
    return found;
  }

  /** Root → id, every entry. */
  path(id: string | null): Entry[] {
    const chain: Entry[] = [];
    const seen = new Set<string>();
    let entry = id ? this.byId.get(id) : undefined;
    while (entry && !seen.has(entry.id)) {
      chain.push(entry);
      seen.add(entry.id);
      entry = entry.parentId ? this.byId.get(entry.parentId) : undefined;
    }
    return chain.reverse();
  }

  /** Root → id, message entries only. */
  messagePath(id: string | null): Entry[] {
    return this.path(this.nearestMessage(id)).filter(entry => this.isMessage(entry));
  }

  messageChildren(id: string | null): string[] {
    return this.#messageChildren.get(id ?? "") ?? [];
  }

  /** Turns on the current path, oldest first. */
  turns(): Turn[] {
    const turns: Turn[] = [];
    for (const entry of this.path(this.leafId)) {
      const role = entry.type === "message" ? entry.message?.role : undefined;
      if (role === "user") {
        turns.push({ userId: entry.id, userText: textOf(entry.message?.content), userTime: time(entry), lastId: null });
      } else if (role === "assistant" || role === "toolResult") {
        if (!turns.length) turns.push({ userId: null, userText: null, userTime: null, lastId: null });
        turns[turns.length - 1].lastId = entry.id;
      }
    }
    return turns;
  }

  /** "Messages" as the strip and branch list count them: each user message, plus one per answered turn. */
  countMessages(entries: Entry[]): number {
    let count = 0;
    let answered = false;
    for (const entry of entries) {
      const role = entry.type === "message" ? entry.message?.role : undefined;
      if (role === "user") {
        count++;
        answered = false;
      } else if (role === "assistant" && !answered && textOf(entry.message?.content).trim()) {
        count++;
        answered = true;
      }
    }
    return count;
  }

  /**
   * Messages on `from`'s path that are not on `to`'s: what moving from `from` to `to` set aside
   * (everything after the branch point for "Continue from here", the old branch for a switch).
   */
  setAside(from: string | null, to: string | null): number {
    const kept = new Set(this.messagePath(to).map(entry => entry.id));
    return this.countMessages(this.messagePath(from).filter(entry => !kept.has(entry.id)));
  }

  /** The newest move marker that still describes the current position (nothing sent since). */
  currentMarker(): (Entry & { data: MarkerData }) | undefined {
    let entry = this.leafId ? this.byId.get(this.leafId) : undefined;
    while (entry && !isContent(entry)) {
      if (isMarker(entry)) return entry;
      entry = entry.parentId ? this.byId.get(entry.parentId) : undefined;
    }
    return undefined;
  }

  markers(): (Entry & { data: MarkerData })[] {
    return this.entries.filter(isMarker);
  }

  /** One row per branch, plus the empty branch you are on after going back. */
  branches(): Branch[] {
    const current = this.nearestMessage(this.leafId);
    // Switching targets the newest raw leaf under a branch's last message, so markers and exits come back too.
    const rawLeaf = new Map<string, string>();
    for (const entry of this.entries) {
      if (this.children.has(entry.id) || entry.type === "model_usage") continue;
      const message = this.nearestMessage(entry.id);
      if (message) rawLeaf.set(message, entry.id);
    }
    const summarizedFrom = new Set(
      this.markers().flatMap(marker => (marker.data.op === "summarize" ? [this.nearestMessage(marker.data.from)] : [])),
    );
    const rows: (Branch & { sort: number })[] = [];
    for (const entry of this.entries) {
      if (!this.isMessage(entry) || this.messageChildren(entry.id).length) continue;
      const path = this.messagePath(entry.id);
      let fork = 0;
      for (let index = path.length - 1; index >= 0; index--) {
        const parent = index > 0 ? path[index - 1].id : null;
        if (this.messageChildren(parent).length > 1) {
          fork = index;
          break;
        }
      }
      const head = path[fork];
      const tail = path.slice(fork);
      rows.push({
        target: rawLeaf.get(entry.id) ?? entry.id,
        title: oneLine(textOf(head.type === "message" ? head.message?.content : head.content)) || "(no text)",
        time: time(entry),
        messages: this.countMessages(tail),
        current: entry.id === current,
        summarized: tail.some(step => summarizedFrom.has(step.id)),
        pending: false,
        sort: this.order.get(head.id) ?? 0,
      });
    }
    rows.sort((a, b) => a.sort - b.sort);
    const result: Branch[] = rows.map(({ sort: _sort, ...row }) => row);
    if (current && this.messageChildren(current).length) {
      const at = this.byId.get(current);
      const text = oneLine(textOf(at?.type === "message" ? at.message?.content : at?.content), 80);
      result.push({
        target: null, title: text ? `New branch after “${text}”` : "New branch", time: null, messages: 0,
        current: true, summarized: false, pending: true,
      });
    }
    return result;
  }

  /**
   * Paseo replays entries it has no row for as `omp-custom-<n>` tool rows, numbered in
   * path order together with id-less custom messages (`history.js` visibleFallback,
   * `message-history.js` mapCustomMessage). Returns the entry behind row n, or undefined.
   */
  replayedFallback(callId: string): Entry | undefined {
    const match = /^omp-custom-(\d+)$/.exec(callId);
    if (!match) return undefined;
    const wanted = Number(match[1]);
    let index = 0;
    for (const entry of this.path(this.leafId)) {
      let counts = false;
      const message = entry.message;
      if (entry.type === "compaction") counts = false;
      else if (message && typeof message.role === "string") {
        const role = message.role;
        if (role === "custom") counts = message.display !== false && !!textOf(message.content) && typeof message.id !== "string";
        else if (role === "developer") counts = !/^<system-reminder[\s>]/.test(textOf(message.content).trimStart());
        else counts = !["system", "user", "assistant", "toolResult", "bashExecution", "pythonExecution", "hookMessage", "branchSummary", "compactionSummary", "fileMention"].includes(role);
      } else if (entry.type !== "custom_message") {
        counts = !CONTROL_TYPES.has(entry.type) && !entry.type.startsWith("tool_execution_");
      }
      if (!counts) continue;
      index++;
      if (index === wanted) return entry;
    }
    return undefined;
  }
}
