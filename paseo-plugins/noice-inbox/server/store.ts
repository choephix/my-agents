import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { type Entry, type EntryRef, entryKey, entrySchema } from "../shared/inbox";

/** Safety cap; with one entry per agent and kind the list rarely gets near it. */
const MAX_ENTRIES = 300;

const fileSchema = z.object({ entries: z.array(entrySchema) });

/** The entries, kept in memory and saved to one JSON file after each change. */
export class InboxStore {
  readonly #file: string;
  readonly #entries = new Map<string, Entry>();
  readonly #loaded: Promise<void>;
  #saving: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
    this.#loaded = readFile(file, "utf8")
      .then((text) => {
        for (const entry of fileSchema.parse(JSON.parse(text)).entries) this.#entries.set(entryKey(entry), entry);
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") console.error(`[noice-inbox] couldn't read ${file}; starting empty`, error);
      });
  }

  async list(): Promise<Entry[]> {
    await this.#loaded;
    return [...this.#entries.values()].sort((a, b) => b.at - a.at);
  }

  /** Adds an entry, replacing the agent's previous entry of the same kind. */
  async put(entry: Entry): Promise<void> {
    await this.#loaded;
    this.#entries.set(entryKey(entry), entry);
    if (this.#entries.size > MAX_ENTRIES) {
      const oldest = [...this.#entries.values()].sort((a, b) => a.at - b.at).slice(0, this.#entries.size - MAX_ENTRIES);
      for (const old of oldest) this.#entries.delete(entryKey(old));
    }
    this.#save();
  }

  async markRead(refs: readonly EntryRef[]): Promise<void> {
    await this.#loaded;
    let changed = false;
    for (const ref of refs) {
      const entry = this.#entries.get(entryKey(ref));
      if (!entry || entry.read) continue;
      this.#entries.set(entryKey(ref), { ...entry, read: true });
      changed = true;
    }
    if (changed) this.#save();
  }

  /** Removes the given entries, or all of them. */
  async clear(refs?: readonly EntryRef[]): Promise<void> {
    await this.#loaded;
    if (refs) for (const ref of refs) this.#entries.delete(entryKey(ref));
    else this.#entries.clear();
    this.#save();
  }

  /** Keeps only the entries whose agent passes `keep`. */
  async retainAgents(keep: (agentId: string) => boolean): Promise<void> {
    await this.#loaded;
    const before = this.#entries.size;
    for (const [key, entry] of this.#entries) if (!keep(entry.agentId)) this.#entries.delete(key);
    if (this.#entries.size !== before) this.#save();
  }

  #save(): void {
    const text = JSON.stringify({ entries: [...this.#entries.values()] });
    const temporary = `${this.#file}.tmp`;
    this.#saving = this.#saving
      .then(async () => {
        await mkdir(dirname(this.#file), { recursive: true });
        await writeFile(temporary, text);
        await rename(temporary, this.#file);
      })
      .catch((error: unknown) => console.error(`[noice-inbox] couldn't save ${this.#file}`, error));
  }
}
