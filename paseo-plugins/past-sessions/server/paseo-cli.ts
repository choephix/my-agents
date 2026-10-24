import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The plugin SDK's PaseoApi (0.11.4) covers neither importing, unarchiving nor listing provider
 * sessions. The Paseo CLI installed next to the daemon's Node does, over the daemon's normal API,
 * so this plugin borrows the CLI's daemon client (`importAgent`, `refreshAgent`,
 * `fetchRecentProviderSessions`), and falls back to running the `paseo` binary for import/reload
 * when that client can't be loaded.
 */
export function paseoBinary(): string {
  const sibling = path.join(path.dirname(process.execPath), "paseo");
  return existsSync(sibling) ? sibling : "paseo";
}

/** One entry of the daemon's `fetch_recent_provider_sessions_response`. */
export interface RecentProviderSession {
  providerId: string;
  providerHandleId: string;
  cwd: string;
  title: string | null;
  firstPromptPreview: string | null;
  lastActivityAt: string;
}

/** The subset of the CLI's `DaemonClient` this plugin calls. */
export interface DaemonClientSubset {
  fetchRecentProviderSessions(options: { providers: string[]; limit: number; cwd?: string }): Promise<{
    entries: RecentProviderSession[];
    providerErrors?: { provider: string; message: string }[];
  }>;
  /** What `paseo import` sends; `sessionId` is the OMP session file or the provider's id. */
  importAgent(input: { provider: string; sessionId: string; cwd: string }): Promise<{ id: string }>;
  /** What `paseo agent reload` sends: unarchives and loads the agent. */
  refreshAgent(agentId: string): Promise<{ agentId: string }>;
  close(): Promise<void>;
}

interface CliModules {
  connectToDaemon(options: { target: unknown }): Promise<DaemonClientSubset>;
  selectDaemonTarget(options: object, env: NodeJS.ProcessEnv, localOnly: boolean): unknown;
}

let modules: Promise<CliModules> | null = null;

/**
 * The CLI package root: inside the desktop app bundle beside the daemon's executable (Windows has
 * no `paseo` beside `Paseo.exe`, only `resources/bin/paseo.cmd`), else via the `paseo` binary.
 */
function cliRoot(): string {
  const bundled = path.join(path.dirname(process.execPath), "resources", "app.asar", "node_modules", "@getpaseo", "cli");
  if (existsSync(bundled)) return bundled;
  // bin/paseo is a symlink into <package>/bin/paseo.
  return path.dirname(path.dirname(realpathSync(paseoBinary())));
}

/** Loads `dist/utils/{client,daemon-target}.js` from the CLI package. */
function cliModules(): Promise<CliModules> {
  modules ??= (async () => {
    const root = cliRoot();
    const load = (file: string) => import(pathToFileURL(path.join(root, "dist", "utils", file)).href);
    const [client, target] = await Promise.all([load("client.js"), load("daemon-target.js")]);
    if (typeof client.connectToDaemon !== "function" || typeof target.selectDaemonTarget !== "function") {
      throw new Error(`Paseo CLI at ${root} has an unexpected layout`);
    }
    return { connectToDaemon: client.connectToDaemon, selectDaemonTarget: target.selectDaemonTarget };
  })();
  modules.catch(() => {
    modules = null;
  });
  return modules;
}

/** Whether the CLI's daemon client loads (it can't when `paseo` is only a bare name on PATH). */
export function daemonClientAvailable(): Promise<boolean> {
  return cliModules().then(
    () => true,
    () => false,
  );
}

/** A short-lived connection to the local daemon, closed after `use`. */
export async function withDaemonClient<T>(use: (client: DaemonClientSubset) => Promise<T>): Promise<T> {
  const { connectToDaemon, selectDaemonTarget } = await cliModules();
  const client = await connectToDaemon({ target: selectDaemonTarget({}, process.env, true) });
  try {
    return await use(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}
