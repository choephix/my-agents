/**
 * Which providers run OMP, as the daemon side reads them from Paseo's config.
 * Loaded once; a provider it doesn't list is asked about again (once per id), so a
 * provider added later is picked up and other providers cost one extra call.
 */
export class OmpProviders {
  readonly #fetch: () => Promise<string[]>;
  #known: ReadonlySet<string> | undefined;
  readonly #rechecked = new Set<string>();
  #loading: Promise<ReadonlySet<string>> | undefined;
  readonly #listeners = new Set<() => void>();

  constructor(fetch: () => Promise<string[]>) {
    this.#fetch = fetch;
  }

  #load(): Promise<ReadonlySet<string>> {
    this.#loading ??= this.#fetch()
      .then(ids => {
        this.#known = new Set(ids);
        for (const listener of this.#listeners) listener();
        return this.#known;
      })
      .finally(() => {
        this.#loading = undefined;
      });
    return this.#loading;
  }

  /** For slash commands: waits for the list. */
  async isOmp(provider: string): Promise<boolean> {
    const known = this.#known ?? (await this.#load());
    if (known.has(provider)) return true;
    if (this.#rechecked.has(provider)) return false;
    this.#rechecked.add(provider);
    return (await this.#load()).has(provider);
  }

  /** For rows: `undefined` until the list has loaded (then it re-renders). */
  peek = (provider: string): boolean | undefined => {
    if (!this.#known) {
      void this.#load().catch(() => undefined);
      return undefined;
    }
    if (!this.#known.has(provider) && !this.#rechecked.has(provider)) void this.isOmp(provider).catch(() => undefined);
    return this.#known.has(provider);
  };

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };
}
