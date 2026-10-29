import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const MarkFile = z.object({ version: z.literal(1) }).catchall(z.record(z.string(), z.string()));

/**
 * One kind of mark (stars, hidden) on list keys (`paseo:<agentId>`, `omp:<sessionId>`,
 * `ext:<provider>:<sessionId>`) → when set, in one JSON file under `field`. Only this plugin's
 * daemon-side process writes it, so the file is read once and every change is written through,
 * one write at a time.
 */
export class MarkStore {
  private marks: Promise<Map<string, string>> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly field: string,
  ) {}

  async keys(): Promise<string[]> {
    return [...(await this.load()).keys()];
  }

  async set(key: string, on: boolean): Promise<string[]> {
    const marks = await this.load();
    if (on === marks.has(key)) return [...marks.keys()];
    if (on) marks.set(key, new Date().toISOString());
    else marks.delete(key);
    await this.save(marks);
    return [...marks.keys()];
  }

  /** Carries a mark over when a session gets a new key, e.g. an OMP session imported as an agent. */
  async move(from: string, to: string): Promise<void> {
    const marks = await this.load();
    const at = marks.get(from);
    if (at === undefined) return;
    marks.delete(from);
    marks.set(to, at);
    await this.save(marks);
  }

  private load(): Promise<Map<string, string>> {
    this.marks ??= (async () => {
      let json: string;
      try {
        json = await readFile(this.file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map<string, string>();
        throw error;
      }
      return new Map(Object.entries(MarkFile.parse(JSON.parse(json))[this.field] ?? {}));
    })().catch((error: unknown) => {
      // A damaged file must not be overwritten by an empty one; retry on the next call.
      this.marks = null;
      throw new Error(`Can't read ${this.field} from ${this.file}: ${error instanceof Error ? error.message : String(error)}`);
    });
    return this.marks;
  }

  private save(marks: Map<string, string>): Promise<void> {
    const json = `${JSON.stringify({ version: 1, [this.field]: Object.fromEntries(marks) }, null, 2)}\n`;
    const next = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, json);
      await rename(temporary, this.file);
    });
    this.writing = next.catch(() => undefined);
    return next;
  }
}

/** Starred rows sort first; hidden rows leave the list until "Show hidden". */
export interface Marks {
  starred: MarkStore;
  hidden: MarkStore;
}

export function openMarks(dir: string): Marks {
  return {
    starred: new MarkStore(path.join(dir, "stars.json"), "stars"),
    hidden: new MarkStore(path.join(dir, "hidden.json"), "hidden"),
  };
}

export async function markKeys(marks: Marks): Promise<{ starred: string[]; hidden: string[] }> {
  const [starred, hidden] = await Promise.all([marks.starred.keys(), marks.hidden.keys()]);
  return { starred, hidden };
}
