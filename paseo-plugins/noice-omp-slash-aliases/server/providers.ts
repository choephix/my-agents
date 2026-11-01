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

/** Paseo's custom providers from `config.json`, read on each call; a missing or broken file has none. */
async function readProviderConfig(home = process.env.PASEO_HOME ?? join(homedir(), ".paseo")): Promise<ProviderConfig> {
  const config = await readFile(join(home, "config.json"), "utf8").then(JSON.parse, () => null);
  return config?.agents?.providers ?? {};
}

export async function readOmpProviders(home?: string): Promise<string[]> {
  return ompProviderIds(await readProviderConfig(home));
}

/** The built-in provider a (custom) provider runs on. */
export async function readBaseProvider(provider: string): Promise<string> {
  return baseProvider(provider, await readProviderConfig());
}
