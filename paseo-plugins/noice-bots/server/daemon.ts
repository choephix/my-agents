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

let client: Promise<DaemonClient> | null = null;

/**
 * The plugin's PaseoApi has no unarchive, delete or provider-model calls, and a provider gets
 * no PaseoApi at all. One long-lived client of this daemon's own loopback endpoint covers them.
 */
export function daemon(): Promise<DaemonClient> {
  client ??= (async () => {
    const home = paseoHome();
    const instance = z.object({ listen: z.string() }).parse(JSON.parse(await readFile(join(home, "paseo.pid"), "utf8")));
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(instance.listen)) {
      throw new Error("Bots needs this daemon's loopback TCP endpoint.");
    }
    const next = new DaemonClient({
      url: `ws://${instance.listen}/ws`,
      clientId: `noice-bots-${randomUUID()}`,
      clientType: "cli",
      localCredential: async () => (await readFile(join(home, "local-credential"), "utf8")).trim(),
      reconnect: { enabled: true },
    });
    await next.connect();
    return next;
  })();
  client.catch(() => { client = null; });
  return client;
}

export async function closeDaemon(): Promise<void> {
  const current = client;
  client = null;
  await (await current?.catch(() => null))?.close();
}
