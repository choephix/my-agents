import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

export type DaemonOp =
  | { op: "reload"; agentId: string }
  | {
    op: "openTab";
    request: Parameters<DaemonClient["importAgent"]>[0];
    name: string;
    config: Parameters<DaemonClient["applyAgentConfig"]>[1];
  };

export type DaemonOpResult = { ok: true; agentId?: string } | { ok: false; error: string };

function paseoHome(): string {
  return resolve((process.env.PASEO_HOME ?? join(homedir(), ".paseo")).replace(/^~(?=\/|$)/, homedir()));
}

/** Paseo's plugin config records where this plugin lives; the bundle itself has no path. */
async function pluginDirectory(home: string): Promise<string> {
  const config = JSON.parse(await readFile(join(home, "config.json"), "utf8"));
  const path = config?.plugins?.["session-tree"]?.path;
  if (typeof path !== "string") throw new Error("Paseo's config has no directory for the session-tree plugin.");
  return path;
}

/**
 * Paseo keeps a plugin's whole server bundle in memory as source, so importing the client SDK
 * (DaemonClient with its 8 MB of protocol schemas) here costs this long-lived process ~17 MB of heap.
 * The rare daemon calls run in a short-lived Node process instead (`daemon-ops.mts`).
 */
async function runOp(op: DaemonOp): Promise<string | undefined> {
  const home = paseoHome();
  const script = join(await pluginDirectory(home), "server", "daemon-ops.mts");
  const stdout = await new Promise<string>((done, fail) => {
    execFile(process.execPath, [script, home, JSON.stringify(op)], (error, out) => (error ? fail(error) : done(out)));
  });
  const result = JSON.parse(stdout) as DaemonOpResult;
  if (!result.ok) throw new Error(result.error);
  return result.agentId;
}

/** Restarts the chat's OMP process from its session file and replays its current path in Paseo. */
export async function reloadChat(agentId: string): Promise<void> {
  await runOp({ op: "reload", agentId });
}

/** Imports a copied session file as a new agent, then names and configures it; returns its id. */
export async function openBranchTab(op: Omit<Extract<DaemonOp, { op: "openTab" }>, "op">): Promise<string> {
  const agentId = await runOp({ op: "openTab", ...op });
  if (!agentId) throw new Error("Paseo did not return the new tab's agent.");
  return agentId;
}
