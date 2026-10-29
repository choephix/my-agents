import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { z } from "zod";

export function paseoHome(): string {
  const configured = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
  return resolve(configured.replace(/^~(?=\/|$)/, homedir()));
}

// PaseoApi omits import/config/fork-context operations. Use the installed SDK's
// native RPCs over this daemon's published local endpoint, never a remote host.
export async function connectLocalDaemon(): Promise<DaemonClient> {
  const home = paseoHome();
  const instance = z.object({ pid: z.number(), listen: z.string() }).parse(JSON.parse(await readFile(join(home, "paseo.pid"), "utf8")));
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(instance.listen)) {
    throw new Error("Side agent requires this daemon's published loopback TCP endpoint.");
  }
  const client = new DaemonClient({
    url: `ws://${instance.listen}/ws`,
    clientId: `side-agent-${randomUUID()}`,
    clientType: "cli",
    localCredential: async () => (await readFile(join(home, "local-credential"), "utf8")).trim(),
    reconnect: { enabled: false },
  });
  try { await client.connect(); return client; }
  catch (error) { await client.close(); throw error; }
}
