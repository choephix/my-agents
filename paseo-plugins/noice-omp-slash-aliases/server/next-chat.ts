import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { ARM_MS } from "../shared/next-chat";

const Armed = z.object({ text: z.string(), cwd: z.string(), armedAt: z.number(), expiresAt: z.number() });
const Used = z.object({ agentId: z.string(), text: z.string(), at: z.number() });
const State = z.object({ version: z.literal(1), armed: z.record(z.string(), Armed), lastUsed: z.record(z.string(), Used) });
export type Armed = z.infer<typeof Armed>;
type State = z.infer<typeof State>;

export function nextChatFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.PASEO_HOME || join(homedir(), ".paseo"), "plugin-data", "omp-slash-aliases", "next-chat.json");
}

/**
 * Instructions armed per workspace for its next chat, and the chat that last took them. Kept in
 * memory, written through to one JSON file so a plugin reload or daemon restart keeps them.
 */
export class NextChatStore {
  readonly #file: string;
  readonly #now: () => number;
  #state: Promise<State> | undefined;
  #writing = Promise.resolve();

  constructor(file: string, now: () => number = Date.now) {
    this.#file = file;
    this.#now = now;
  }

  async #load(): Promise<State> {
    this.#state ??= readFile(this.#file, "utf8").then(
      text => State.parse(JSON.parse(text)),
      () => ({ version: 1 as const, armed: {}, lastUsed: {} }),
    );
    const state = await this.#state;
    for (const [workspaceId, armed] of Object.entries(state.armed)) if (armed.expiresAt <= this.#now()) delete state.armed[workspaceId];
    return state;
  }

  #save(state: State): Promise<void> {
    const text = JSON.stringify(state);
    this.#writing = this.#writing.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.#file), { recursive: true });
      const temp = `${this.#file}.${process.pid}.tmp`;
      await writeFile(temp, text, { mode: 0o600 });
      await rename(temp, this.#file);
    });
    return this.#writing;
  }

  async armed(): Promise<{ workspaceId: string; expiresAt: number }[]> {
    return Object.entries((await this.#load()).armed).map(([workspaceId, { expiresAt }]) => ({ workspaceId, expiresAt }));
  }

  async get(workspaceId: string) {
    const state = await this.#load();
    return { armed: state.armed[workspaceId] ?? null, lastUsed: state.lastUsed[workspaceId] ?? null };
  }

  /** Arms `text` for 30 minutes; blank text disarms. */
  async set(workspaceId: string, cwd: string, text: string): Promise<number | null> {
    const state = await this.#load();
    const now = this.#now();
    if (text.trim()) state.armed[workspaceId] = { text, cwd: resolve(cwd), armedAt: now, expiresAt: now + ARM_MS };
    else delete state.armed[workspaceId];
    await this.#save(state);
    return state.armed[workspaceId]?.expiresAt ?? null;
  }

  /** Disarms and returns the newest text armed for a workspace in directory `cwd`. */
  async take(cwd: string): Promise<{ workspaceId: string; armed: Armed } | undefined> {
    const state = await this.#load();
    const dir = resolve(cwd);
    const [found] = Object.entries(state.armed)
      .filter(([, armed]) => armed.cwd === dir)
      .sort(([, a], [, b]) => b.armedAt - a.armedAt);
    if (!found) return undefined;
    const [workspaceId, armed] = found;
    delete state.armed[workspaceId];
    await this.#save(state);
    return { workspaceId, armed };
  }

  /** Re-arms text taken by mistake, unless the workspace was armed again since. */
  async restore(workspaceId: string, armed: Armed): Promise<void> {
    const state = await this.#load();
    if (state.armed[workspaceId] || armed.expiresAt <= this.#now()) return;
    state.armed[workspaceId] = armed;
    await this.#save(state);
  }

  async used(workspaceId: string, agentId: string, text: string): Promise<void> {
    const state = await this.#load();
    state.lastUsed[workspaceId] = { agentId, text, at: this.#now() };
    await this.#save(state);
  }

  /** Drops an archived workspace's entries. */
  async forget(workspaceId: string): Promise<void> {
    const state = await this.#load();
    if (!state.armed[workspaceId] && !state.lastUsed[workspaceId]) return;
    delete state.armed[workspaceId];
    delete state.lastUsed[workspaceId];
    await this.#save(state);
  }
}
