import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { INSTRUCTIONS_METADATA_KEY } from "../shared/next-chat";

const Used = z.object({ agentId: z.string(), text: z.string(), at: z.number() });
const LegacyState = z.object({ version: z.literal(1), lastUsed: z.record(z.string(), Used) });
const State = z.object({ version: z.literal(2), lastUsed: Used.nullable() });
export type LastUsedInstructions = z.infer<typeof Used>;
type State = z.infer<typeof State>;

export function nextChatFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.PASEO_HOME || join(homedir(), ".paseo"), "plugin-data", "omp-slash-aliases", "next-chat.json");
}

/** Extracts non-blank instructions from an agent metadata record. */
export function extractInstructions(metadata: Readonly<Record<string, unknown>> | undefined): string | null {
  const value = metadata?.[INSTRUCTIONS_METADATA_KEY];
  if (typeof value !== "string") return null;
  return value.trim() ? value : null;
}

/** Appends custom instructions after any existing per-agent system prompt. */
export function appendSystemPrompt(existing: string | undefined, instructions: string): string {
  return existing?.trim() ? `${existing}\n\n${instructions}` : instructions;
}

function parseState(raw: unknown): State {
  const current = State.safeParse(raw);
  if (current.success) return current.data;
  const legacy = LegacyState.safeParse(raw);
  if (legacy.success) {
    const newest = Object.values(legacy.data.lastUsed).sort((a, b) => b.at - a.at)[0] ?? null;
    return { version: 2, lastUsed: newest };
  }
  return { version: 2, lastUsed: null };
}

/**
 * Remembers the instructions most recently applied to a new chat so the editor can offer
 * "Copy into the box". Written through to one JSON file so reloads and restarts keep it.
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
      text => parseState(JSON.parse(text)),
      () => ({ version: 2 as const, lastUsed: null }),
    );
    return this.#state;
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

  async lastUsed(): Promise<LastUsedInstructions | null> {
    return (await this.#load()).lastUsed;
  }

  async recordUsed(agentId: string, text: string): Promise<void> {
    const state = await this.#load();
    state.lastUsed = { agentId, text, at: this.#now() };
    await this.#save(state);
  }
}
