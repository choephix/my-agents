import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { TanState, TanStep } from "../shared/tan";

/*
 * Reads a /tan tangent's state from OMP's own session files (OMP internals, verified
 * against omp 18.12):
 * - The chat's session file `<parent>.jsonl` gets an `async-result` custom_message when
 *   background jobs finish: `details.jobs[] = {jobId, status, agentId: "Tan-…", label, durationMs}`.
 * - Each tangent runs in `<parent>/Tan-<id>.jsonl`: a forked copy of the chat, then a
 *   `session_init` entry (task = your words), the tangent's own turns, and `session_exit`.
 */

const MAX_STEPS = 40;
const STEP_CHARS = 160;
/** Paseo's echo of a /tan send and its tangent's session file are created within milliseconds. */
const MATCH_WINDOW_MS = 10_000;

export interface DeliveredJob {
  jobId: string;
  status: string;
  agentId?: string;
  label?: string;
  durationMs?: number;
  /** This job's part of the delivery text: its result, or its error. */
  text: string;
}

/** One `async-result` entry: background jobs whose results OMP handed to the chat. */
export interface Delivery {
  at: number;
  jobs: DeliveredJob[];
}

/** The tangent's own part of its session file. */
export interface TanTranscript {
  work: string;
  startedAt: number;
  steps: TanStep[];
  model?: string;
  /** The last assistant reply that ended the run (stopReason other than toolUse). */
  final?: { text: string; stopReason: string; error?: string; at: number };
  exitedAt?: number;
  lastAt: number;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const time = (value: unknown): number | undefined => {
  const ms = typeof value === "string" ? Date.parse(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(ms) ? ms : undefined;
};
const oneLine = (text: string) => {
  const line = text.trim().replace(/\s+/g, " ");
  return line.length > STEP_CHARS ? `${line.slice(0, STEP_CHARS - 1)}…` : line;
};

/** Splits OMP's async-result text into each job's result (template: prompts/tools/async-result.md). */
export function jobTexts(content: string, jobIds: string[]): Map<string, string> {
  const body = content.replace(/^\s*<system-notice>\s*\n?/, "").replace(/\n?<\/system-notice>\s*$/, "");
  const texts = new Map<string, string>();
  if (jobIds.length === 1) {
    texts.set(jobIds[0], body.replace(/^[^\n]*\n/, "").trim());
    return texts;
  }
  const parts = body.split(/^── Job (\S+)(?: \(.*\))? ──$/m);
  // parts: [intro, id1, text1, id2, text2, …]
  for (let index = 1; index + 1 < parts.length; index += 2) texts.set(parts[index], parts[index + 1].trim());
  return texts;
}

/** An `async-result` session entry, or null for every other line. */
export function parseDelivery(entry: unknown): Delivery | null {
  if (!isObject(entry) || entry.type !== "custom_message" || entry.customType !== "async-result") return null;
  const details = isObject(entry.details) ? entry.details : {};
  const raw = Array.isArray(details.jobs) ? details.jobs.filter(isObject) : [];
  const ids = raw.map(job => str(job.jobId) ?? "");
  const texts = jobTexts(str(entry.content) ?? "", ids);
  return {
    at: time(entry.timestamp) ?? 0,
    jobs: raw.map((job, index) => ({
      jobId: ids[index],
      status: str(job.status) ?? "completed",
      agentId: str(job.agentId),
      label: str(job.label),
      durationMs: typeof job.durationMs === "number" ? job.durationMs : undefined,
      text: texts.get(ids[index]) ?? "",
    })),
  };
}

/** The tool call's own short description: OMP tools carry an intent (`i`); others a path, command, … */
function describeCall(args: unknown): string {
  if (!isObject(args)) return "";
  for (const key of ["i", "title", "description", "path", "command", "url", "query", "pattern", "language"]) {
    const value = str(args[key]);
    if (value?.trim()) return oneLine(value);
  }
  return "";
}

/**
 * Parses the lines of a Tan session file from its `session_init` entry on.
 * Tool results are skipped without parsing (they are the big lines).
 */
export function parseTanLines(lines: Iterable<string>): TanTranscript | null {
  let transcript: TanTranscript | null = null;
  for (const line of lines) {
    if (!line) continue;
    if (line.includes('"role":"toolResult"')) {
      // Read just its time: the entry's own timestamp comes before its (large) message.
      const stamp = transcript ? time(/"timestamp":"([^"]+)"/.exec(line)?.[1]) : undefined;
      if (transcript && stamp) transcript.lastAt = Math.max(transcript.lastAt, stamp);
      continue;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // A line still being written.
    }
    if (!isObject(entry)) continue;
    const at = time(entry.timestamp);
    if (entry.type === "session_init") {
      transcript = { work: (str(entry.task) ?? "").trim(), startedAt: at ?? 0, steps: [], lastAt: at ?? 0 };
      continue;
    }
    if (!transcript) continue;
    if (at) transcript.lastAt = Math.max(transcript.lastAt, at);
    if (entry.type === "custom" && entry.customType === "session_exit") {
      transcript.exitedAt = at ?? transcript.lastAt;
      continue;
    }
    const message = isObject(entry.message) ? entry.message : undefined;
    if (entry.type !== "message" || message?.role !== "assistant") continue;
    transcript.model = str(message.model) ?? transcript.model;
    const content = Array.isArray(message.content) ? message.content.filter(isObject) : [];
    const text = content
      .filter(part => part.type === "text")
      .map(part => str(part.text) ?? "")
      .join("")
      .trim();
    const stopReason = str(message.stopReason) ?? "";
    if (stopReason === "toolUse") {
      if (text) transcript.steps.push({ text: oneLine(text) });
      for (const part of content) {
        if (part.type === "toolCall") transcript.steps.push({ tool: str(part.name) ?? "tool", text: describeCall(part.arguments) });
      }
      if (transcript.steps.length > MAX_STEPS) transcript.steps.splice(0, transcript.steps.length - MAX_STEPS);
      transcript.final = undefined;
    } else {
      transcript.final = { text, stopReason, error: str(message.errorMessage), at: at ?? transcript.lastAt };
    }
  }
  return transcript;
}

/**
 * The row's state. A delivery is authoritative; otherwise the tangent's own file says
 * whether it ended; a tangent that has not ended while no OMP process that could be
 * running it is left (the chat's process exited or was replaced) counts as stopped.
 */
export function deriveState(
  tanId: string,
  transcript: TanTranscript | null,
  delivered: DeliveredJob | undefined,
  hostAlive: boolean,
): TanState | null {
  if (!transcript && !delivered) return null;
  const base = {
    tanId,
    work: transcript?.work ?? delivered?.label?.replace(/^\/tan /, "") ?? "",
    startedAt: transcript?.startedAt ?? 0,
    model: transcript?.model,
    steps: transcript?.steps ?? [],
  };
  const answer = transcript?.final?.stopReason === "stop" ? transcript.final.text : "";
  if (delivered) {
    const status = delivered.status === "failed" ? "failed" : delivered.status === "cancelled" ? "stopped" : "done";
    return {
      ...base,
      status,
      durationMs: delivered.durationMs,
      result: status === "done" ? answer || delivered.text : delivered.text || answer,
    };
  }
  const t = transcript!;
  if (t.final && t.exitedAt !== undefined) {
    const status = t.final.stopReason === "stop" ? "done" : t.final.stopReason === "aborted" ? "stopped" : "failed";
    return {
      ...base,
      status,
      durationMs: t.final.at - t.startedAt,
      result: status === "done" ? t.final.text : (t.final.error ?? t.final.text),
    };
  }
  if (t.exitedAt !== undefined || !hostAlive) {
    return { ...base, status: "stopped", durationMs: t.lastAt - t.startedAt, result: "" };
  }
  return { ...base, status: "running", result: "" };
}

/** Of `candidates` (Tan id → start time), the one started closest to `at`. */
export function nearestTangent(candidates: ReadonlyMap<string, number>, at: number): string | undefined {
  let best: string | undefined;
  let bestDistance = MATCH_WINDOW_MS;
  for (const [tanId, startedAt] of candidates) {
    const distance = Math.abs(startedAt - at);
    if (distance <= bestDistance) [best, bestDistance] = [tanId, distance];
  }
  return best;
}

/** Complete lines of `text`; a trailing partial line is left for the next read. */
function completeLines(text: string): { lines: string[]; consumed: number } {
  const end = text.lastIndexOf("\n");
  if (end < 0) return { lines: [], consumed: 0 };
  return { lines: text.slice(0, end).split("\n"), consumed: Buffer.byteLength(text.slice(0, end + 1)) };
}

async function readFrom(path: string, offset: number, size: number): Promise<string> {
  if (size <= offset) return "";
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(size - offset);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** Reads and caches session files; each one is parsed incrementally as it grows. */
export class TanSessions {
  readonly #agentsRoot: string;
  readonly #parents = new Map<string, string>();
  readonly #deliveries = new Map<string, { offset: number; list: Delivery[] }>();
  readonly #tans = new Map<string, { size: number; mtimeMs: number; initOffset: number; transcript: TanTranscript | null }>();
  readonly #starts = new Map<string, number>();

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.#agentsRoot = join(env.PASEO_HOME || join(homedir(), ".paseo"), "agents");
  }

  /** The chat's OMP session file, from Paseo's agent record (`persistence.nativeHandle`). */
  async parentFile(agentId: string): Promise<string | undefined> {
    const cached = this.#parents.get(agentId);
    if (cached) return cached;
    for (const dir of await readdir(this.#agentsRoot).catch(() => [] as string[])) {
      const record = await readFile(join(this.#agentsRoot, dir, `${agentId}.json`), "utf8").catch(() => undefined);
      if (!record) continue;
      const parsed: unknown = JSON.parse(record);
      const persistence = isObject(parsed) && isObject(parsed.persistence) ? parsed.persistence : undefined;
      const handle = str(persistence?.nativeHandle);
      if (typeof handle === "string" && handle.endsWith(".jsonl")) {
        this.#parents.set(agentId, handle);
        return handle;
      }
    }
    return undefined;
  }

  /** Every `async-result` delivery in the chat's session file so far. */
  async deliveries(parent: string): Promise<Delivery[]> {
    const cached = this.#deliveries.get(parent) ?? { offset: 0, list: [] };
    const size = (await stat(parent).catch(() => undefined))?.size ?? 0;
    if (size < cached.offset) Object.assign(cached, { offset: 0, list: [] }); // Rewritten.
    const { lines, consumed } = completeLines(await readFrom(parent, cached.offset, size));
    for (const line of lines) {
      if (!line.includes('"async-result"')) continue;
      try {
        const delivery = parseDelivery(JSON.parse(line));
        if (delivery) cached.list.push(delivery);
      } catch {
        // Not a JSON line.
      }
    }
    cached.offset += consumed;
    this.#deliveries.set(parent, cached);
    return cached.list;
  }

  tanDir(parent: string): string {
    return parent.slice(0, -".jsonl".length);
  }

  /** The tangent's own transcript; re-read only from its `session_init` line when the file changed. */
  async transcript(parent: string, tanId: string): Promise<TanTranscript | null> {
    const path = join(this.tanDir(parent), `${tanId}.jsonl`);
    const info = await stat(path).catch(() => undefined);
    if (!info) return null;
    const cached = this.#tans.get(path);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.transcript;
    let initOffset = cached?.initOffset ?? -1;
    let text: string;
    if (initOffset < 0) {
      const whole = await readFile(path, "utf8");
      const at = whole.lastIndexOf('{"type":"session_init"');
      if (at < 0) return null;
      initOffset = Buffer.byteLength(whole.slice(0, at));
      text = whole.slice(at);
    } else {
      text = await readFrom(path, initOffset, info.size);
    }
    const transcript = parseTanLines(text.split("\n"));
    this.#tans.set(path, { size: info.size, mtimeMs: info.mtimeMs, initOffset, transcript });
    return transcript;
  }

  /** Start times of the chat's tangents, from each file's session header (its first lines). */
  async tangentStarts(parent: string): Promise<Map<string, number>> {
    const starts = new Map<string, number>();
    const dir = this.tanDir(parent);
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const match = /^(Tan-[A-Za-z0-9]+)\.jsonl$/.exec(name);
      if (!match) continue;
      const path = join(dir, name);
      let startedAt = this.#starts.get(path);
      if (startedAt === undefined) {
        const head = await readFrom(path, 0, Math.min(4096, (await stat(path)).size));
        for (const line of head.split("\n")) {
          const header = /"type":"session"[^\n]*?"timestamp":"([^"]+)"/.exec(line);
          if (header) {
            startedAt = Date.parse(header[1]);
            break;
          }
        }
        if (startedAt === undefined || !Number.isFinite(startedAt)) continue;
        this.#starts.set(path, startedAt);
      }
      starts.set(basename(name, ".jsonl"), startedAt);
    }
    return starts;
  }
}
