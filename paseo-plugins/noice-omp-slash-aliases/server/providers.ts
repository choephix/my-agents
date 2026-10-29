import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

/** Ids of the providers that run OMP: `omp` itself and every custom provider built on it. */
export function ompProviderIds(providers: ProviderConfig): string[] {
  return ["omp", ...Object.keys(providers).filter(id => id !== "omp" && baseProvider(id, providers) === "omp")];
}

/** Reads Paseo's `config.json` on each call; a missing or broken file leaves just `omp`. */
export async function readOmpProviders(home = process.env.PASEO_HOME ?? join(homedir(), ".paseo")): Promise<string[]> {
  const config = await readFile(join(home, "config.json"), "utf8").then(JSON.parse, () => null);
  return ompProviderIds(config?.agents?.providers ?? {});
}
