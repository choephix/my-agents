import type { Mapping } from "./images";

export interface ProviderEntry { id: string; label: string }
export interface ProviderRow { id: string; label: string; mapping?: Mapping; configured: boolean }

/**
 * One row per daemon provider plus saved icons whose provider is gone from the daemon (renamed or
 * removed from config), so they stay visible and removable. Customized rows come first; each group
 * keeps daemon order.
 */
export function providerRows(providers: readonly ProviderEntry[], mappings: readonly Mapping[]): ProviderRow[] {
  const byProvider = new Map(mappings.map((mapping) => [mapping.provider, mapping]));
  const rows: ProviderRow[] = providers.map((entry) => ({ ...entry, mapping: byProvider.get(entry.id), configured: true }));
  const known = new Set(providers.map((entry) => entry.id));
  for (const mapping of mappings) {
    if (!known.has(mapping.provider)) rows.push({ id: mapping.provider, label: mapping.provider, mapping, configured: false });
  }
  return [...rows.filter((row) => row.mapping), ...rows.filter((row) => !row.mapping)];
}
