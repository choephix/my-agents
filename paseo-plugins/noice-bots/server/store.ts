import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Bot, Message, Thread } from "../shared/contracts";
import { paseoHome } from "./daemon";
import { z } from "zod";

const root = () => join(paseoHome(), "plugin-data", "noice-bots");
/** Threads' OMP session files: kept apart from ~/.omp, so session lists and searches don't show threads. */
export const sessionsDir = () => join(root(), "sessions");
/** Local calendar day, `YYYY-MM-DD`. */
export const dayOf = (ms: number) => new Date(ms).toLocaleDateString("sv-SE");

const Copy = z.object({ botId: z.string(), day: z.string(), messages: z.array(Message) });
type Copy = z.infer<typeof Copy>;

async function readJson<T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  try { return schema.parse(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error(`noice-bots: unreadable ${path}`, error);
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, path);
}

/**
 * bots.json; threads/<bot>/<day>.json (thread rows, what the hub shows); copies/<thread>.json
 * (the saved copy, plus where its row lives). Day files load on demand and stay cached.
 */
export class Store {
  bots: Bot[] = [];
  readonly #days = new Map<string, Thread[]>();
  readonly #writes = new Map<string, Promise<void>>();

  async load(): Promise<void> {
    this.bots = (await readJson(join(root(), "bots.json"), z.object({ bots: z.array(Bot) }), { bots: [] })).bots;
  }
  saveBots(): Promise<void> { return this.#write(join(root(), "bots.json"), () => ({ bots: this.bots })); }
  bot(id: string): Bot | undefined { return this.bots.find(bot => bot.id === id); }
  botOfWorkspace(workspaceId: string | null): Bot | undefined { return this.bots.find(bot => bot.workspaceId === workspaceId); }

  async day(botId: string, day: string): Promise<Thread[]> {
    const key = `${botId}/${day}`;
    let threads = this.#days.get(key);
    if (!threads) {
      threads = (await readJson(join(root(), "threads", `${key}.json`), z.object({ threads: z.array(Thread) }), { threads: [] })).threads;
      this.#days.set(key, this.#days.get(key) ?? threads);
    }
    return this.#days.get(key)!;
  }
  async days(botId: string): Promise<string[]> {
    const files = await readdir(join(root(), "threads", botId)).catch(() => [] as string[]);
    return files.filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).map(file => file.slice(0, 10)).sort();
  }

  async thread(id: string): Promise<Thread | undefined> {
    const copy = await this.#copy(id);
    return copy && (await this.day(copy.botId, copy.day)).find(thread => thread.id === id);
  }
  async add(thread: Thread): Promise<void> {
    const day = dayOf(thread.createdAt);
    (await this.day(thread.botId, day)).push(thread);
    await this.#write(join(root(), "copies", `${thread.id}.json`), () => ({ botId: thread.botId, day, messages: [{ role: "user", text: thread.question }] }));
    await this.saveDay(thread);
  }
  /** Rewrites the day file of a thread whose row object was changed in place. */
  saveDay(thread: Thread): Promise<void> {
    const key = `${thread.botId}/${dayOf(thread.createdAt)}`;
    return this.#write(join(root(), "threads", `${key}.json`), () => ({ threads: this.#days.get(key) ?? [] }));
  }

  async messages(id: string): Promise<Message[]> { return (await this.#copy(id))?.messages ?? []; }
  async setMessages(thread: Thread, messages: Message[]): Promise<void> {
    await this.#write(join(root(), "copies", `${thread.id}.json`), () => ({ botId: thread.botId, day: dayOf(thread.createdAt), messages }));
  }

  /** Drops a bot's day files and the saved copies of the given threads; `bots.json` is the caller's. */
  async removeThreads(botId: string, threadIds: readonly string[]): Promise<void> {
    await Promise.all(this.#writes.values());
    for (const key of this.#days.keys()) if (key.startsWith(`${botId}/`)) this.#days.delete(key);
    await rm(join(root(), "threads", botId), { recursive: true, force: true });
    for (const id of threadIds) await rm(join(root(), "copies", `${id}.json`), { force: true });
  }

  #copy(id: string): Promise<Copy | undefined> {
    if (!/^[0-9a-f-]{36}$/.test(id)) return Promise.resolve(undefined);
    return readJson<Copy | undefined>(join(root(), "copies", `${id}.json`), Copy, undefined);
  }

  /** Serialized per file; each write takes the latest content when its turn comes. */
  #write(path: string, content: () => unknown): Promise<void> {
    const next = (this.#writes.get(path) ?? Promise.resolve()).then(() => writeJson(path, content()));
    const settled = next.catch(error => console.error(`noice-bots: writing ${path} failed`, error));
    this.#writes.set(path, settled);
    return next;
  }
}
