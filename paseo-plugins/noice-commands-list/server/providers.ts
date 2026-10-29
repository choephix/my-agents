import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

type ProviderConfig = Record<string, { extends?: string } | undefined>;

/** Follows `extends` in Paseo's provider config (`omp-nilo` extends `omp`) to the built-in base. */
export function baseProvider(provider: string, providers: ProviderConfig): string {
  const seen = new Set<string>();
  let current = provider;
  while (!seen.has(current)) {
    seen.add(current);
    const parent = providers[current]?.extends;
    if (!parent) return current;
    current = parent;
  }
  return current;
}

/**
 * True for OMP agents, including custom providers built on it. Only OMP takes an out-of-band
 * `/follow-up` that queues behind a running reply without cancelling it.
 */
export async function queuesFollowUps(provider: string): Promise<boolean> {
  if (provider === "omp") return true;
  const home = process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
  const config = await readFile(path.join(home, "config.json"), "utf8").then(JSON.parse, () => null);
  return baseProvider(provider, config?.agents?.providers ?? {}) === "omp";
}
