import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

/**
 * Talks to the OMP extension `session-tree` (`.omp/extensions/session-tree/session-tree.ts`;
 * keep the file shapes in sync). One directory per Paseo chat:
 *
 *   $PASEO_HOME/omp-session-tree/<agentId>/.process-<pid>       OMP process that serves requests (holds its REVISION)
 *   $PASEO_HOME/omp-session-tree/<agentId>/<id>.request.json    written here
 *   $PASEO_HOME/omp-session-tree/<agentId>/<id>.result.json     written by OMP
 *   $PASEO_HOME/omp-session-tree/<agentId>/<id>.cancel          written here
 */
export type LinkRequest =
  | { op: "goto"; target: string; kind: string; summarize?: boolean }
  | { op: "summarize"; from: string; fork: string; focus: string };

const ResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("running"), phase: z.enum(["switching", "summarizing"]) }),
  z.object({ status: z.literal("done"), leafId: z.string().nullable(), editorText: z.string().optional(), summaryId: z.string().optional() }),
  z.object({ status: z.literal("cancelled") }),
  z.object({ status: z.literal("error"), error: z.string() }),
]);
export type LinkResult = z.infer<typeof ResultSchema>;

export function linkRoot(): string {
  const home = process.env.PASEO_HOME?.replace(/^~(?=\/|$)/, homedir()) || join(homedir(), ".paseo");
  return join(home, "omp-session-tree");
}

export interface OmpHost {
  pid: number;
  env: Record<string, string>;
}

/**
 * Paseo's OMP hosts for this chat: `omp --mode rpc-ui …` started with the chat's PASEO_AGENT_ID.
 * Reads every process's short cmdline, and the environment only of OMP RPC processes.
 */
export async function ompHosts(agentId: string): Promise<OmpHost[]> {
  const hosts: OmpHost[] = [];
  await Promise.all(
    (await readdir("/proc")).map(async name => {
      if (!/^\d+$/.test(name)) return;
      try {
        const [command = "", ...args] = (await readFile(`/proc/${name}/cmdline`, "utf8")).split("\0").filter(Boolean);
        if (!/(^|\/)omp$/.test(command) || !args.some(arg => /^(--mode=)?rpc(-ui)?$/.test(arg))) return;
        const env: Record<string, string> = {};
        for (const pair of (await readFile(`/proc/${name}/environ`, "utf8")).split("\0")) {
          const at = pair.indexOf("=");
          if (at > 0) env[pair.slice(0, at)] = pair.slice(at + 1);
        }
        if (env.PASEO_AGENT_ID === agentId) hosts.push({ pid: Number(name), env });
      } catch {
        // Exited meanwhile, or another user's process.
      }
    }),
  );
  return hosts;
}

/**
 * Whether an OMP process with this environment loads the session-tree extension: through a config
 * overlay (PI_CONFIG_FILES, how Paseo's OMP providers get it) or the profile's extensions folder.
 */
export async function loadsExtension(env: Record<string, string>): Promise<boolean> {
  for (const file of (env.PI_CONFIG_FILES ?? "").split(":").filter(Boolean)) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (/\.omp\/extensions\/session-tree\b/.test(text)) return true;
  }
  const home = env.HOME || homedir();
  const agentDir = env.OMP_PROFILE ? join(home, ".omp", "profiles", env.OMP_PROFILE, "agent") : join(home, ".omp", "agent");
  return readdir(join(agentDir, "extensions")).then(names => names.includes("session-tree"), () => false);
}

/** What the extension writes into its process marker; bump on both sides when requests gain a field. 2: `summarize` on goto. */
export const REVISION = 2;

/** Pids of this chat's OMP processes that run the extension at REVISION or later (older ones get reloaded). */
export async function servingPids(agentId: string): Promise<Set<number>> {
  const dir = join(linkRoot(), agentId);
  const names = await readdir(dir).catch(() => [] as string[]);
  const pids = await Promise.all(
    names.map(async name => {
      if (!/^\.process-\d+$/.test(name)) return [];
      const revision = Number(await readFile(join(dir, name), "utf8").catch(() => "")) || 1;
      return revision >= REVISION ? [Number(name.slice(9))] : [];
    }),
  );
  return new Set(pids.flat());
}

export async function sendRequest(agentId: string, sessionFile: string, request: LinkRequest): Promise<string> {
  const dir = join(linkRoot(), agentId);
  await mkdir(dir, { recursive: true });
  const id = `r${Date.now().toString(36)}${randomUUID().slice(0, 8)}`;
  const path = join(dir, `${id}.request.json`);
  await writeFile(`${path}.tmp`, JSON.stringify({ version: 1, id, createdAt: Date.now(), sessionFile, ...request }));
  await rename(`${path}.tmp`, path);
  return id;
}

export async function readResult(agentId: string, id: string): Promise<LinkResult | undefined> {
  try {
    const parsed = ResultSchema.safeParse(JSON.parse(await readFile(join(linkRoot(), agentId, `${id}.result.json`), "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Waits for a final result; `onRunning` sees each running phase. Throws if nobody claims the request in time. */
export async function awaitResult(
  agentId: string,
  id: string,
  options: { claimMs: number; totalMs: number; onRunning?: (phase: "switching" | "summarizing") => void },
): Promise<Exclude<LinkResult, { status: "running" }>> {
  const started = Date.now();
  let claimed = false;
  for (;;) {
    const result = await readResult(agentId, id);
    if (result && result.status !== "running") return result;
    if (result) {
      claimed = true;
      options.onRunning?.(result.phase);
    }
    const waited = Date.now() - started;
    if (!claimed && waited > options.claimMs) {
      throw new Error("The OMP agent did not pick this up. Reload the chat (paseo agent reload) and try again.");
    }
    if (waited > options.totalMs) throw new Error("The OMP agent did not finish in time.");
    await sleep(150);
  }
}

export async function cancelRequest(agentId: string, id: string): Promise<void> {
  await writeFile(join(linkRoot(), agentId, `${id}.cancel`), "");
}

/** Removes a request's files, and process markers of OMP processes that are gone. */
export async function cleanUp(agentId: string, id: string): Promise<void> {
  const dir = join(linkRoot(), agentId);
  const names = await readdir(dir).catch(() => [] as string[]);
  const live = new Set((await ompHosts(agentId)).map(host => host.pid));
  await Promise.all(
    names
      .filter(name => name.startsWith(`${id}.`) || (/^\.process-\d+$/.test(name) && !live.has(Number(name.slice(9)))))
      .map(name => rm(join(dir, name), { force: true })),
  );
}
