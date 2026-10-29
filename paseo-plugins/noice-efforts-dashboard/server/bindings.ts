import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BindingSchema, type Binding } from "../shared/rpc";

const FileSchema = z.object({ version: z.literal(1), bindings: z.record(z.string(), BindingSchema) });

/**
 * Workspace id → effort (or "no effort"), in the plugin's own JSON file. Effort files are never
 * written; this file is the only thing the plugin stores.
 *
 * Writes run one after another, each reading the bindings left by the one before, so two binds at
 * once both land. A failed read or write is not remembered: the next call tries the file again.
 */
export class BindingStore {
  private loaded: Promise<Record<string, Binding>> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  all(): Promise<Record<string, Binding>> {
    if (!this.loaded) {
      const loading = readFile(this.file, "utf8").then(
        (text) => FileSchema.parse(JSON.parse(text)).bindings,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return {};
          throw error;
        },
      );
      this.loaded = loading;
      loading.catch(() => {
        if (this.loaded === loading) this.loaded = null;
      });
    }
    return this.loaded;
  }

  set(workspaceId: string, binding: Binding | null): Promise<void> {
    const write = this.writing
      .catch(() => {})
      .then(async () => {
        const bindings = { ...(await this.all()) };
        if (binding) bindings[workspaceId] = binding;
        else delete bindings[workspaceId];
        await mkdir(path.dirname(this.file), { recursive: true });
        const temp = `${this.file}.${process.pid}.tmp`;
        await writeFile(temp, `${JSON.stringify({ version: 1, bindings }, null, 2)}\n`);
        await rename(temp, this.file);
        // Only what is on disk is served.
        this.loaded = Promise.resolve(bindings);
      });
    this.writing = write;
    return write;
  }
}
