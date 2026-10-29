/**
 * A Map with a bound: once it holds more than `maxEntries` entries, or their weights add up to more
 * than `maxWeight`, the least recently used entries go. `get` and `set` count as uses. The plugin
 * server lives as long as the daemon, so every cache in it is one of these.
 */
export class Lru<K, V> {
  private readonly entries = new Map<K, { value: V; weight: number }>();
  private total = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight = Number.POSITIVE_INFINITY,
  ) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Map keeps insertion order: re-inserting moves the entry to the newest end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /** Replaces any entry under `key`. A value heavier than `maxWeight` on its own isn't kept. */
  set(key: K, value: V, weight = 0): void {
    this.delete(key);
    if (weight > this.maxWeight) return;
    this.entries.set(key, { value, weight });
    this.total += weight;
    for (const [oldest, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries && this.total <= this.maxWeight) break;
      this.entries.delete(oldest);
      this.total -= entry.weight;
    }
  }

  delete(key: K): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.total -= entry.weight;
  }
}
