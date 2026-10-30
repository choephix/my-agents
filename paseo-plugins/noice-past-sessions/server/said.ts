import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { readdirSync, statSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { FindSaidResult, SaidHit } from "../shared/rpc";
import { listAllAgents, listAllWorkspaces, sessionRootsFromProviders } from "./list";
import { cleanTitle, titleFromPrompt } from "./merge";
import { HEAD_BYTES, mapLimited, parseSessionHead, readHead, type OmpSessionRoot } from "./omp-sessions";
import { stripWrappers } from "./preview";

type Paseo = PluginHandlerContext["paseo"];

const INDEX_VERSION = 2;
const CHUNK_BYTES = 4 * 1024 * 1024;
/** Files read at once: each holds a CHUNK_BYTES buffer. */
const READ_CONCURRENCY = 8;
// How OMP serializes a user message record. Inside a JSON string the quotes would be escaped, so
// a raw match is always a record of its own.
const USER_MARK = '"message":{"role":"user"';
/** While searching, session files are re-checked at most this often. */
const RECHECK_MS = 10_000;
/** The index leaves memory after this long without a search. */
const UNLOAD_MS = 5 * 60_000;
const OWNERS_FRESH_MS = 15_000;
const MAX_HITS = 50;
/** Matching messages a row shows; a row the screen expanded gets up to MAX_EXPANDED_MESSAGES. */
const SHOWN_MESSAGES = 9;
const MAX_EXPANDED_MESSAGES = 200;
/** A search waits this long for the index; past it, it answers with progress. */
const ANSWER_WAIT_MS = 300;

/** `[sent at (ms), text]`: one user message, harness wrappers removed. */
type SaidMessage = [number, string];

interface SaidSession {
  file: string;
  provider: string;
  /** Null when the file has no session header; kept so it isn't re-read on every search. */
  sessionId: string | null;
  cwd: string;
  /** OMP's title, else the first prompt's first line. */
  title: string | null;
  /** The session file this one was copied from (`/prose`, forks); null for an original. */
  parent: string | null;
  size: number;
  mtimeMs: number;
  /** Bytes parsed so far: up to the end of the last complete line. */
  offset: number;
  messages: SaidMessage[];
}

interface Owner {
  id: string;
  title: string | null;
  archived: boolean;
  workspaceName: string | null;
  updatedAt: string;
}

// Paseo's voice mode stores what you dictated inside `<spoken-input>`, then an `<instruction>` for
// the model. The dictated text is yours; the generic wrapper strip would drop it with the tag.
const SPOKEN = /<spoken-input>([\s\S]*?)<\/spoken-input>(?:\s*<instruction>[\s\S]*?<\/instruction>)?/g;

function said(content: unknown): string | null {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .flatMap((part) => (part && part.type === "text" && typeof part.text === "string" ? [part.text] : []))
            .join("\n")
        : "";
  const stripped = stripWrappers(text.replace(SPOKEN, " $1 ")).trim();
  return stripped || null;
}

/** User messages in complete lines of `text`, appended to `out`. */
export function collectUserMessages(text: string, out: SaidMessage[]): void {
  let index = 0;
  while ((index = text.indexOf(USER_MARK, index)) >= 0) {
    const start = text.lastIndexOf("\n", index) + 1;
    let end = text.indexOf("\n", index);
    if (end < 0) end = text.length;
    index = end;
    let record: { type?: unknown; timestamp?: unknown; message?: { content?: unknown } };
    try {
      record = JSON.parse(text.slice(start, end));
    } catch {
      continue;
    }
    if (record?.type !== "message") continue;
    const message = said(record.message?.content);
    if (message) out.push([typeof record.timestamp === "string" ? Date.parse(record.timestamp) || 0 : 0, message]);
  }
}

/**
 * User messages from byte `from` to the end of the file's last complete line; a line OMP is still
 * writing is left for the next read. From 0 it also returns the file's first HEAD_BYTES as text.
 */
async function readUserMessages(
  file: string,
  from: number,
): Promise<{ messages: SaidMessage[]; offset: number; head: string | null }> {
  const handle = await open(file, "r");
  try {
    const messages: SaidMessage[] = [];
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let head: string | null = null;
    let position = from;
    let carry = Buffer.alloc(0);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const data = carry.length ? Buffer.concat([carry, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead);
      if (from === 0 && head === null) head = data.toString("utf8", 0, Math.min(HEAD_BYTES, data.length));
      // A newline byte never sits inside a multi-byte UTF-8 character, so cutting there is safe.
      const end = data.lastIndexOf(0x0a);
      if (end >= 0) collectUserMessages(data.toString("utf8", 0, end), messages);
      // A copy: `buffer` is reused by the next read.
      carry = Buffer.from(data.subarray(end + 1));
    }
    return { messages, offset: position - carry.length, head };
  } finally {
    await handle.close();
  }
}

/** Top-level session files; subagent transcripts live one folder deeper and are skipped. */
function sessionFiles(roots: OmpSessionRoot[]): { file: string; provider: string }[] {
  const files: { file: string; provider: string }[] = [];
  for (const root of roots) {
    let dirs;
    try {
      dirs = readdirSync(root.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const folder = path.join(root.dir, dir.name);
      let entries;
      try {
        entries = readdirSync(folder, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push({ file: path.join(folder, entry.name), provider: root.provider });
      }
    }
  }
  return files;
}

/** The message, whitespace collapsed, cut around its first match; plus where each word occurs. */
export function snippetAround(text: string, words: string[]): { snippet: string; marks: [number, number][] } {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const hits = words.map((word) => lower.indexOf(word)).filter((at) => at >= 0);
  const first = hits.length ? Math.min(...hits) : 0;
  let start = Math.max(0, first - 60);
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space >= 0 && space < first) start = space + 1;
  }
  let end = Math.min(flat.length, start + 240);
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    if (space > first) end = space;
  }
  const snippet = `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
  const shown = snippet.toLowerCase();
  const ranges: [number, number][] = [];
  for (const word of words) {
    for (let at = shown.indexOf(word); at >= 0; at = shown.indexOf(word, at + word.length)) ranges.push([at, at + word.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const marks: [number, number][] = [];
  for (const range of ranges) {
    const last = marks[marks.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else marks.push([range[0], range[1]]);
  }
  return { snippet, marks };
}

/**
 * Every user message of every top-level OMP session, for finding a chat by what was said in it.
 * Nothing runs until the first search: it builds the index (or loads it from `file` and reads only
 * what sessions appended since), keeps it in memory while searches keep coming, and writes it back
 * and drops it after UNLOAD_MS without one. No watcher, no timer while unloaded.
 */
export class SaidIndex {
  #sessions: Map<string, SaidSession> | null = null;
  #dirty = false;
  #checkedAt = 0;
  #pending: Promise<void> | null = null;
  #progress = { done: 0, total: 0 };
  #owners: { at: number; map: Map<string, Owner> } | null = null;
  #unloadTimer: ReturnType<typeof setTimeout> | undefined;
  #writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async search(needle: string, paseo: Paseo, expand: readonly string[] = []): Promise<FindSaidResult> {
    const started = performance.now();
    this.#touch();
    const fresh = this.#ensureFresh(paseo);
    // No unhandled rejection when the build outlives this call; the next search starts it again.
    fresh.catch(() => {});
    const ready = await Promise.race([fresh.then(() => true), sleep(ANSWER_WAIT_MS, false)]);
    const sessions = this.#sessions;
    if (!ready || !sessions) return { state: "indexing", ...this.#progress };

    const words = [...new Set(needle.toLowerCase().split(/\s+/).filter(Boolean))];
    let indexedChats = 0;
    let indexedMessages = 0;
    const found: { session: SaidSession; matched: SaidMessage[] }[] = [];
    for (const session of sessions.values()) {
      if (!session.sessionId) continue;
      indexedChats += 1;
      indexedMessages += session.messages.length;
      if (!words.length) continue;
      const matched = session.messages.filter((message) => {
        const lower = message[1].toLowerCase();
        return words.every((word) => lower.includes(word));
      });
      if (matched.length) found.push({ session, matched });
    }
    const owners = found.length ? await this.#ownerMap(paseo) : new Map<string, Owner>();
    // `/prose` and forks start a new session file that copies the old one's messages (with new
    // timestamps) and names it as `parentSession`, by path or by id. A family of copies gets one
    // row, on the copy most worth opening: a live tab, then an archived agent, then the newest file.
    const byId = new Map<string, string>();
    if (found.length) for (const session of sessions.values()) if (session.sessionId) byId.set(session.sessionId, session.file);
    const rootOf = (file: string): string => {
      let root = file;
      const seen = new Set([file]);
      for (;;) {
        const parent = sessions.get(root)?.parent;
        const next = parent ? (sessions.has(parent) ? parent : byId.get(parent)) : undefined;
        if (!next || seen.has(next)) return root;
        seen.add(next);
        root = next;
      }
    };
    const rows = new Map<string, { session: SaidSession; owner: Owner | null; rank: number; copies: number; sent: Map<string, number> }>();
    for (const item of found) {
      const owner = owners.get(item.session.sessionId ?? "") ?? owners.get(item.session.file) ?? null;
      const rank = owner ? (owner.archived ? 1 : 2) : 0;
      const key = rootOf(item.session.file);
      let row = rows.get(key);
      if (!row) {
        row = { session: item.session, owner, rank, copies: -1, sent: new Map() };
        rows.set(key, row);
      } else if (rank > row.rank || (rank === row.rank && item.session.mtimeMs > row.session.mtimeMs)) {
        Object.assign(row, { session: item.session, owner, rank });
      }
      row.copies += 1;
      // Copies repeat their source's messages: keep each text once, at its earliest time.
      for (const [at, text] of item.matched) {
        const known = row.sent.get(text);
        if (known === undefined || at < known) row.sent.set(text, at);
      }
    }
    const ranked = [...rows.values()].map((row) => ({
      ...row,
      messages: [...row.sent].map(([text, at]): SaidMessage => [at, text]).sort((a, b) => b[0] - a[0]),
    }));
    ranked.sort((a, b) => b.messages[0][0] - a.messages[0][0]);
    const hits = ranked.slice(0, MAX_HITS).map(({ session, owner, copies, messages }): SaidHit => {
      const shown = expand.includes(session.file) ? MAX_EXPANDED_MESSAGES : SHOWN_MESSAGES;
      return {
        file: session.file,
        sessionId: session.sessionId ?? "",
        provider: session.provider,
        cwd: session.cwd,
        title: cleanTitle(owner?.title) ?? session.title ?? "Empty session",
        agent: owner ? { id: owner.id, archived: owner.archived, workspaceName: owner.workspaceName } : null,
        at: new Date(messages[0][0]).toISOString(),
        messages: messages.slice(0, shown).map(([at, text]) => ({ at: new Date(at).toISOString(), ...snippetAround(text, words) })),
        matches: messages.length,
        copies,
      };
    });
    return {
      state: "ready",
      hits,
      chats: rows.size,
      home: homedir(),
      indexedChats,
      indexedMessages,
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  /** After a restore or import the session's owner changed; the next search asks the daemon again. */
  forgetOwners(): void {
    this.#owners = null;
  }

  async dispose(): Promise<void> {
    clearTimeout(this.#unloadTimer);
    if (this.#sessions && this.#dirty) {
      this.#dirty = false;
      await this.#write(this.#sessions);
    }
    await this.#writing;
  }

  #touch(): void {
    clearTimeout(this.#unloadTimer);
    this.#unloadTimer = setTimeout(() => void this.#unload(), UNLOAD_MS);
  }

  async #unload(): Promise<void> {
    const sessions = this.#sessions;
    if (!sessions) return;
    if (this.#pending) {
      this.#touch();
      return;
    }
    // Dropped first, so a search arriving during the write loads from disk; the file then has
    // older offsets at worst, and reading on from those yields the same messages.
    this.#sessions = null;
    this.#owners = null;
    this.#checkedAt = 0;
    if (this.#dirty) {
      this.#dirty = false;
      await this.#write(sessions).catch((error: unknown) => console.warn(`noice-past-sessions: said index not saved: ${String(error)}`));
    }
  }

  #ensureFresh(paseo: Paseo): Promise<void> {
    if (this.#pending) return this.#pending;
    if (this.#sessions && Date.now() - this.#checkedAt < RECHECK_MS) return Promise.resolve();
    this.#pending = (async () => {
      const config = await paseo.config.get().catch(() => null);
      const roots = sessionRootsFromProviders(config?.config.providers ?? {}, homedir());
      const loaded = !this.#sessions;
      this.#progress = { done: 0, total: 0 };
      const sessions = this.#sessions ?? (await this.#load());
      this.#sessions = sessions;
      await this.#refresh(sessions, roots);
      this.#checkedAt = Date.now();
      // A build or catch-up after loading is the expensive part: save it now, not only on unload.
      if (loaded && this.#dirty) {
        this.#dirty = false;
        await this.#write(sessions);
      }
    })().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async #load(): Promise<Map<string, SaidSession>> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as { version?: unknown; sessions?: SaidSession[] };
      if (raw.version !== INDEX_VERSION || !Array.isArray(raw.sessions)) return new Map();
      return new Map(raw.sessions.map((session) => [session.file, session]));
    } catch {
      return new Map();
    }
  }

  #write(sessions: Map<string, SaidSession>): Promise<void> {
    const body = JSON.stringify({ version: INDEX_VERSION, sessions: [...sessions.values()] });
    this.#writing = this.#writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await writeFile(temp, body);
      await rename(temp, this.file);
    });
    return this.#writing;
  }

  async #refresh(sessions: Map<string, SaidSession>, roots: OmpSessionRoot[]): Promise<void> {
    const work: { file: string; provider: string; size: number; mtimeMs: number }[] = [];
    const seen = new Set<string>();
    for (const { file, provider } of sessionFiles(roots)) {
      seen.add(file);
      const info = statSync(file, { throwIfNoEntry: false });
      if (!info) continue;
      const known = sessions.get(file);
      if (known && known.size === info.size && known.mtimeMs === info.mtimeMs) {
        known.provider = provider;
        continue;
      }
      work.push({ file, provider, size: info.size, mtimeMs: info.mtimeMs });
    }
    for (const file of sessions.keys()) {
      if (seen.has(file)) continue;
      sessions.delete(file);
      this.#dirty = true;
    }
    this.#progress = { done: 0, total: work.length };
    await mapLimited(work, READ_CONCURRENCY, async ({ file, provider, size, mtimeMs }) => {
      try {
        const known = sessions.get(file);
        // OMP only appends, except for the padded title record it rewrites in place at the top.
        const from = known && size >= known.offset ? known.offset : 0;
        const read = await readUserMessages(file, from);
        const head = parseSessionHead(read.head ?? (await readHead(file)));
        sessions.set(file, {
          file,
          provider,
          sessionId: head?.sessionId ?? null,
          cwd: head?.cwd ?? "",
          title: cleanTitle(head?.title) ?? titleFromPrompt(head?.firstPrompt ?? null),
          parent: head?.parentSession ?? null,
          size,
          mtimeMs,
          offset: read.offset,
          messages: from > 0 && known ? known.messages.concat(read.messages) : read.messages,
        });
        this.#dirty = true;
      } catch (error) {
        // Deleted while listing, unreadable: skipped, tried again on the next search.
        console.warn(`noice-past-sessions: said index skipped ${file}: ${String(error)}`);
      } finally {
        this.#progress.done += 1;
      }
    });
  }

  async #ownerMap(paseo: Paseo): Promise<Map<string, Owner>> {
    if (this.#owners && Date.now() - this.#owners.at < OWNERS_FRESH_MS) return this.#owners.map;
    const [agents, workspaces] = await Promise.all([listAllAgents(paseo), listAllWorkspaces(paseo)]);
    const names = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
    const map = new Map<string, Owner>();
    for (const { agent } of agents) {
      const owner: Owner = {
        id: agent.id,
        title: agent.title ?? null,
        archived: Boolean(agent.archivedAt),
        workspaceName: (agent.workspaceId && names.get(agent.workspaceId)) || null,
        updatedAt: agent.updatedAt,
      };
      const refs = [agent.persistence?.sessionId, agent.persistence?.nativeHandle, agent.runtimeInfo?.sessionId];
      for (const ref of refs) {
        if (typeof ref !== "string" || !ref) continue;
        const previous = map.get(ref);
        // A live agent wins over an archived one; then the most recently updated.
        const better =
          !previous ||
          (previous.archived && !owner.archived) ||
          (previous.archived === owner.archived && owner.updatedAt > previous.updatedAt);
        if (better) map.set(ref, owner);
      }
    }
    this.#owners = { at: Date.now(), map };
    return map;
  }
}
