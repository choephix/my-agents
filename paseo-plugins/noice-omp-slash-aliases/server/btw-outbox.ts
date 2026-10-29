import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

async function readDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Undismissed answers of one chat, newest first. Unreadable or foreign files are skipped. */
export async function listEntries(root: string, agentId: string, now = Date.now()): Promise<BtwEntry[]> {
  const dir = join(root, SafeIdSchema.parse(agentId));
  const names = await readDir(dir);
  const dismissed = new Set(names.filter(name => name.endsWith(".dismissed")).map(name => name.slice(0, -10)));
  const entries: BtwEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".") || !name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    if (dismissed.has(id)) continue;
    let parsed;
    try {
      parsed = BtwFileSchema.safeParse(JSON.parse(await readFile(join(dir, name), "utf8")));
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

export interface ChatSummary {
  agentId: string;
  count: number;
  running: boolean;
  updatedAt: number;
}

/** Chats with at least one undismissed answer. */
export async function summarizeChats(root: string, now = Date.now()): Promise<ChatSummary[]> {
  const summaries: ChatSummary[] = [];
  for (const agentId of await readDir(root)) {
    if (!SafeIdSchema.safeParse(agentId).success) continue;
    const entries = await listEntries(root, agentId, now);
    if (entries.length === 0) continue;
    summaries.push({
      agentId,
      count: entries.length,
      running: entries.some(entry => entry.status === "running"),
      updatedAt: Math.max(...entries.map(entry => entry.updatedAt)),
    });
  }
  return summaries;
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
  const names = await readDir(join(root, SafeIdSchema.parse(agentId)));
  return new Set(names.flatMap(name => (PROCESS_MARKER.test(name) ? [Number(name.slice(9))] : [])));
}

/**
 * Deletes answers and dismissal markers past retention, process markers of
 * dead processes, then empty chat folders.
 */
export async function pruneOutbox(root: string, isAlive: (pid: number) => boolean, now = Date.now()): Promise<void> {
  for (const agentId of await readDir(root)) {
    const dir = join(root, agentId);
    for (const name of await readDir(dir)) {
      const file = join(dir, name);
      if (PROCESS_MARKER.test(name)) {
        if (!isAlive(Number(name.slice(9)))) await rm(file, { force: true });
        continue;
      }
      const info = await stat(file).catch(() => undefined);
      if (info && now - info.mtimeMs > RETENTION_MS) await rm(file, { force: true });
    }
    if ((await readDir(dir)).length === 0) await rm(dir, { recursive: true, force: true });
  }
}
