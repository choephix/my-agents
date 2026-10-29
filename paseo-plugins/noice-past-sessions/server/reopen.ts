import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { reopenPastSession } from "../shared/rpc";
import { workspaceFolder } from "./list";
import { daemonClientAvailable, paseoBinary, withDaemonClient, type ImportRequest } from "./paseo-cli";
import { resolvedOrSelf } from "./omp-sessions";
import type { Marks } from "./marks";

type ImportInput = Extract<RpcInput<typeof reopenPastSession>, { source: "import" }>;

/**
 * Several workspaces can share a folder; without a workspace id the daemon picks one of them. A
 * session from the panel's folder goes to the panel's workspace. Any other folder (Project scope)
 * keeps the daemon's pick: it rejects a workspace whose folder isn't the session's cwd.
 */
export async function importRequest(input: ImportInput, folder: string | null): Promise<ImportRequest> {
  const request = { provider: input.provider, sessionId: input.handle, cwd: input.cwd };
  if (folder === null) return request;
  const [cwd, target] = await Promise.all([resolvedOrSelf(input.cwd), resolvedOrSelf(folder)]);
  return cwd === target ? { ...request, workspaceId: input.workspaceId } : request;
}

// Restore = `refreshAgent` (unarchives and loads an archived agent); Import = `importAgent` (a
// provider session becomes a Paseo agent). Both go through the CLI's daemon client, ~4 ms; the
// `paseo` binary (~300 ms of startup per click) is only the fallback when that client won't load.
async function runPaseo(args: string[]): Promise<unknown> {
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(paseoBinary(), [...args, "--json"], {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    const detail = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.trim();
    throw new Error(detail ? `${failure.message}: ${detail}` : failure.message);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Unexpected paseo output: ${stdout.slice(0, 500)}`);
  }
}

function agentIdOf(result: unknown): string {
  const record = Array.isArray(result) ? result[0] : result;
  const agentId = record && typeof record === "object" ? (record as Record<string, unknown>).agentId : null;
  if (typeof agentId !== "string" || !agentId) {
    throw new Error(`paseo returned no agentId: ${JSON.stringify(result).slice(0, 500)}`);
  }
  return agentId;
}

export async function reopenHandler(
  input: RpcInput<typeof reopenPastSession>,
  marks: Marks,
  paseo: PluginHandlerContext["paseo"],
): Promise<RpcOutput<typeof reopenPastSession>> {
  const direct = await daemonClientAvailable();
  if (input.source === "paseo") {
    const agentId = direct
      ? await withDaemonClient(async (client) => (await client.refreshAgent(input.agentId)).agentId)
      : agentIdOf(await runPaseo(["agent", "reload", input.agentId]));
    // Reopening a hidden session means it's wanted after all: archived again later, it's listed.
    await marks.hidden.set(`paseo:${input.agentId}`, false);
    return { agentId };
  }
  // `paseo import` has no workspace option: the binary fallback leaves the pick to the daemon.
  const agentId = direct
    ? await withDaemonClient(async (client) => {
        const request = await importRequest(input, await workspaceFolder(paseo, input.workspaceId));
        return (await client.importAgent(request)).id;
      })
    : agentIdOf(await runPaseo(["import", "--provider", input.provider, "--cwd", input.cwd, input.handle]));
  // The session is listed as this agent from now on; a star stays with it, a hidden mark doesn't.
  await marks.starred.move(input.key, `paseo:${agentId}`);
  await marks.hidden.set(input.key, false);
  return { agentId };
}
