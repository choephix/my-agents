import { type FSWatcher, mkdirSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type BtwEntry, BtwFileSchema, SafeIdSchema } from "../shared/btw";

/**
 * Reads the /btw outbox the OMP extension `headless-builtins` writes:
 * `<root>/<agentId>/<id>.json` per answer, `<id>.dismissed` once dismissed,
 * `.process-<pid>` per OMP process that has /btw support.
 */

/** A running answer that has not been written for this long lost its OMP process. */
export const STALE_RUNNING_MS = 10 * 60_000;
/** Answers and dismissal markers older than this are deleted. */
export const RETENTION_MS = 7 * 24 * 60 * 60_000;
/** `.process-<pid>`: written by each RPC OMP process whose extension handles /btw. */
const PROCESS_MARKER = /^\.process-\d+$/;

export function btwRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.PASEO_HOME || join(homedir(), ".paseo"), "omp-btw");
}

/** Synchronous on purpose: scanning ~50 answer files takes ~0.3 ms sync vs ~3.8 ms with promises. */
function readDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Undismissed answers of one chat, newest first. Unreadable or foreign files are skipped. */
export async function listEntries(root: string, agentId: string, now = Date.now()): Promise<BtwEntry[]> {
  const dir = join(root, SafeIdSchema.parse(agentId));
  const names = readDir(dir);
  const dismissed = new Set(names.filter(name => name.endsWith(".dismissed")).map(name => name.slice(0, -10)));
  const entries: BtwEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".") || !name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    if (dismissed.has(id)) continue;
    let parsed;
    try {
      parsed = BtwFileSchema.safeParse(JSON.parse(readFileSync(join(dir, name), "utf8")));
    } catch {
      continue; // Removed between readdir and read, or not JSON.
    }
    if (!parsed.success || parsed.data.agentId !== agentId || parsed.data.record.id !== id) continue;
    const entry = parsed.data.record;
    entries.push(
      entry.status === "running" && now - entry.updatedAt > STALE_RUNNING_MS
        ? { ...entry, status: "interrupted", error: "OMP stopped before the answer finished." }
        : entry,
    );
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export interface ChatEntries {
  agentId: string;
  entries: BtwEntry[];
}

/** Chats with at least one undismissed answer and their entries, sorted by agentId for stable snapshots. */
export async function listAllChats(root: string, now = Date.now()): Promise<ChatEntries[]> {
  const chats: ChatEntries[] = [];
  for (const agentId of readDir(root).sort()) {
    if (!SafeIdSchema.safeParse(agentId).success) continue;
    const entries = await listEntries(root, agentId, now);
    if (entries.length === 0) continue;
    chats.push({ agentId, entries });
  }
  return chats;
}

export interface ChatSummary {
  agentId: string;
  count: number;
  running: boolean;
  updatedAt: number;
}

/** Chats with at least one undismissed answer. */
export async function summarizeChats(root: string, now = Date.now()): Promise<ChatSummary[]> {
  return (await listAllChats(root, now)).map(({ agentId, entries }) => ({
    agentId,
    count: entries.length,
    running: entries.some(entry => entry.status === "running"),
    updatedAt: Math.max(...entries.map(entry => entry.updatedAt)),
  }));
}

/**
 * The marker comes first: the extension never writes a record once it exists,
 * and cancels the answer if it is still running.
 */
export async function dismissEntry(root: string, agentId: string, id: string): Promise<void> {
  const dir = join(root, SafeIdSchema.parse(agentId));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${SafeIdSchema.parse(id)}.dismissed`), "");
  await rm(join(dir, `${id}.json`), { force: true });
}

/** Pids of the OMP processes that announced /btw support for this chat. */
export async function markedPids(root: string, agentId: string): Promise<Set<number>> {
  const names = readDir(join(root, SafeIdSchema.parse(agentId)));
  return new Set(names.flatMap(name => (PROCESS_MARKER.test(name) ? [Number(name.slice(9))] : [])));
}

/**
 * Deletes answers and dismissal markers past retention, process markers of
 * dead processes, then empty chat folders.
 */
export async function pruneOutbox(root: string, isAlive: (pid: number) => boolean, now = Date.now()): Promise<void> {
  for (const agentId of readDir(root)) {
    const dir = join(root, agentId);
    for (const name of readDir(dir)) {
      const file = join(dir, name);
      if (PROCESS_MARKER.test(name)) {
        if (!isAlive(Number(name.slice(9)))) await rm(file, { force: true });
        continue;
      }
      const info = await stat(file).catch(() => undefined);
      if (info && now - info.mtimeMs > RETENTION_MS) await rm(file, { force: true });
    }
    if (readDir(dir).length === 0) await rm(dir, { recursive: true, force: true });
  }
}

const isRelevantOutboxFile = (name: string) => name.endsWith(".json") || name.endsWith(".dismissed");

/**
 * Watches `$PASEO_HOME/omp-btw` and each chat subfolder while at least one client is subscribed.
 * Ignores `.tmp` writes and `.process-<pid>` markers, debounces bursts, and arms a single timer
 * when any answer is still running so a dead OMP process still flips to `interrupted` after
 * `STALE_RUNNING_MS` with zero polling while idle.
 */
export class BtwOutboxWatcher {
  readonly #root: string;
  readonly #debounceMs: number;
  readonly #listeners = new Set<() => void>();
  #rootWatcher: FSWatcher | undefined;
  readonly #chatWatchers = new Map<string, FSWatcher>();
  #debounceTimer: ReturnType<typeof setTimeout> | undefined;
  #staleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(root: string, options: { debounceMs?: number } = {}) {
    this.#root = root;
    this.#debounceMs = options.debounceMs ?? 50;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#startWatching();
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#stopWatching();
    };
  }

  /** Notifies active listeners immediately (e.g. after a dismissal or prune). */
  notify(): void {
    if (this.#listeners.size === 0) return;
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = undefined;
    }
    for (const listener of this.#listeners) listener();
  }

  /** Arms a one-shot timer for the earliest running entry's stale deadline, or clears it when idle. */
  scheduleStaleCheck(entries: readonly BtwEntry[], now = Date.now()): void {
    if (this.#staleTimer) {
      clearTimeout(this.#staleTimer);
      this.#staleTimer = undefined;
    }
    if (this.#listeners.size === 0) return;
    let earliest = Infinity;
    for (const entry of entries) {
      if (entry.status === "running") earliest = Math.min(earliest, entry.updatedAt + STALE_RUNNING_MS);
    }
    if (!Number.isFinite(earliest)) return;
    this.#staleTimer = setTimeout(() => {
      this.#staleTimer = undefined;
      this.notify();
    }, Math.max(50, earliest - now + 50));
  }

  close(): void {
    this.#listeners.clear();
    this.#stopWatching();
  }

  #startWatching(): void {
    try {
      mkdirSync(this.#root, { recursive: true });
      this.#rootWatcher = watch(this.#root, (_event, filename) => {
        const name = filename?.toString();
        if (name && !SafeIdSchema.safeParse(name).success) return;
        this.#syncChatWatchers();
        this.#scheduleEmit();
      });
      this.#rootWatcher.on("error", () => {
        this.#rootWatcher?.close();
        this.#rootWatcher = undefined;
      });
      this.#syncChatWatchers();
    } catch {
      this.#stopWatching();
    }
  }

  #syncChatWatchers(): void {
    if (!this.#rootWatcher) return;
    const present = new Set<string>();
    for (const name of readDir(this.#root)) {
      if (!SafeIdSchema.safeParse(name).success) continue;
      const dir = join(this.#root, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      present.add(name);
      if (this.#chatWatchers.has(name)) continue;
      try {
        const watcher = watch(dir, (_event, filename) => {
          const file = filename?.toString();
          if (file && !isRelevantOutboxFile(file)) return;
          this.#scheduleEmit();
        });
        watcher.on("error", () => {
          watcher.close();
          this.#chatWatchers.delete(name);
        });
        this.#chatWatchers.set(name, watcher);
      } catch {
        // Folder vanished before we could attach; root watcher already triggered a scan.
      }
    }
    for (const [agentId, watcher] of this.#chatWatchers) {
      if (present.has(agentId)) continue;
      watcher.close();
      this.#chatWatchers.delete(agentId);
    }
  }

  #scheduleEmit(): void {
    if (this.#listeners.size === 0 || this.#debounceTimer) return;
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = undefined;
      for (const listener of this.#listeners) listener();
    }, this.#debounceMs);
  }

  #stopWatching(): void {
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = undefined;
    }
    if (this.#staleTimer) {
      clearTimeout(this.#staleTimer);
      this.#staleTimer = undefined;
    }
    this.#rootWatcher?.close();
    this.#rootWatcher = undefined;
    for (const watcher of this.#chatWatchers.values()) watcher.close();
    this.#chatWatchers.clear();
  }
}
