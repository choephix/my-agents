// Runs as its own short-lived Node process, started by daemon.ts: `node daemon-ops.ts <paseo home> <op json>`.
// Prints one DaemonOpResult as JSON.
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { z } from "zod";
import type { DaemonOp, DaemonOpResult } from "./daemon";

// PaseoApi has no reload ("refresh") or import. Use the installed SDK's native RPCs over this
// daemon's published local endpoint, never a remote host (same as side-agent).
async function connect(home: string): Promise<DaemonClient> {
  const instance = z.object({ pid: z.number(), listen: z.string() }).parse(JSON.parse(await readFile(join(home, "paseo.pid"), "utf8")));
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(instance.listen)) {
    throw new Error("Session tree requires this daemon's published loopback TCP endpoint.");
  }
  const client = new DaemonClient({
    url: `ws://${instance.listen}/ws`,
    clientId: `session-tree-${randomUUID()}`,
    clientType: "cli",
    localCredential: async () => (await readFile(join(home, "local-credential"), "utf8")).trim(),
    reconnect: { enabled: false },
  });
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}

async function run(daemon: DaemonClient, op: DaemonOp): Promise<string | undefined> {
  if (op.op === "reload") {
    await daemon.refreshAgent(op.agentId);
    return undefined;
  }
  const child = await daemon.importAgent(op.request);
  try {
    await daemon.updateAgent(child.id, { name: op.name });
    await daemon.applyAgentConfig(child.id, op.config);
    return child.id;
  } catch (error) {
    // Never leave a half-configured tab behind.
    await daemon.archiveAgent(child.id).catch(() => undefined);
    throw error;
  }
}

let result: DaemonOpResult;
try {
  const daemon = await connect(process.argv[2]);
  try {
    result = { ok: true, agentId: await run(daemon, JSON.parse(process.argv[3]) as DaemonOp) };
  } finally {
    await daemon.close();
  }
} catch (error) {
  result = { ok: false, error: error instanceof Error ? error.message : String(error) };
}
process.stdout.write(JSON.stringify(result));
process.exit(0);
