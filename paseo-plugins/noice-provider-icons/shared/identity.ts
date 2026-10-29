/**
 * Who owns a provider glyph. Two tiers, both read-only:
 * 1. `data-testid` of the glyph's nearest test-id ancestor. Paseo's e2e suite depends on these ids,
 *    so they are the most stable public hook; several also carry the host id.
 * 2. Props of the React components above the glyph, for surfaces whose DOM carries no provider id
 *    (composer model trigger, picker header, settings provider rows, sub-agent rows, schedules).
 */

export interface Directory {
  /** Agent id → exact provider id, from the official agents SDK. */
  agents: ReadonlyMap<string, string>;
  /** Provider ids known to the daemon, from the official providers snapshot. */
  providers: ReadonlySet<string>;
  /** Exact provider label → provider id ("" when two providers share a label). */
  labels: ReadonlyMap<string, string>;
  /** Called for an agent id that is not in `agents` yet (created after the page loaded). */
  missing?(agentId: string): void;
}

export interface Owner { provider?: string; host?: string }

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const agentTab = new RegExp(`^workspace-tab-agent_(${UUID})$`);
// The row's children carry `agent-row-title-<host>-<id>` etc.; those are not the row.
const agentRow = new RegExp(`^agent-row-((?!title-|workspace-|project-|branch-).+)-(${UUID})$`);

function agentProvider(directory: Directory, agentId: string): string | undefined {
  const provider = directory.agents.get(agentId);
  if (!provider) directory.missing?.(agentId);
  return provider;
}

/** Tier 1. Returns undefined when the id is not a provider-glyph owner or names nothing known. */
export function ownerFromTestId(testId: string, directory: Directory, label?: string | null): Owner | undefined {
  let provider: string | undefined;
  let host: string | undefined;
  let match: RegExpExecArray | null;
  if ((match = agentTab.exec(testId))) provider = agentProvider(directory, match[1]);
  else if ((match = agentRow.exec(testId))) [provider, host] = [directory.agents.get(match[2]), match[1]];
  else if ((match = /^command-center-model-([^:]+):([^:]+):/.exec(testId))) [provider, host] = [match[2], match[1]];
  else if (testId.startsWith("model-provider-")) {
    const id = testId.slice("model-provider-".length);
    if (directory.providers.has(id)) provider = id;
  } else if (testId.startsWith("provider-catalog-tile-")) provider = testId.slice("provider-catalog-tile-".length);
  else if (testId.startsWith("model-row-")) {
    // `model-row-<provider>-<model>`: ids may contain dashes, so take the longest known provider prefix.
    const rest = testId.slice("model-row-".length);
    for (const id of directory.providers) if (rest.startsWith(`${id}-`) && id.length > (provider?.length ?? 0)) provider = id;
  } else if (testId === "import-session-filter-trigger" && label?.startsWith("Filter: ")) {
    provider = directory.labels.get(label.slice("Filter: ".length)) || undefined;
  }
  return provider ? { provider, host } : undefined;
}

interface TabTarget { kind?: string; agentId?: string; parentAgentId?: string; setup?: { provider?: string } }

/** The subset of component props that identify a provider glyph's owner. */
export interface IconScope {
  provider?: unknown;
  serverId?: unknown;
  iconKey?: unknown;
  def?: { id?: unknown };
  agent?: { provider?: unknown; serverId?: unknown };
  entry?: { providerId?: unknown };
  row?: { provider?: unknown };
  tab?: { target?: TabTarget };
  item?: { target?: TabTarget };
  label?: unknown;
  leadingSlot?: unknown;
  selectedProvider?: unknown;
}

const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined);

/** Tier 2. Scopes run from the glyph outward; the nearest semantic owner wins. */
export function providerFromScopes(scopes: readonly IconScope[], directory: Directory): string | undefined {
  for (const props of scopes) {
    // Combobox options (import-session provider filter) carry only the visible label.
    const labelled = props.leadingSlot && typeof props.label === "string" ? directory.labels.get(props.label) : undefined;
    const direct = labelled || (text(props.provider) ?? text(props.iconKey) ?? text(props.def?.id)
      ?? text(props.agent?.provider) ?? text(props.entry?.providerId) ?? text(props.row?.provider));
    if (direct) return direct;
    const target = props.tab?.target ?? props.item?.target;
    if (target?.kind === "agent" && target.agentId) return agentProvider(directory, target.agentId);
    if (target?.kind === "provider_subagent" && target.parentAgentId) return agentProvider(directory, target.parentAgentId);
    if (target?.kind === "draft" && text(target.setup?.provider)) return target.setup?.provider;
    if (text(props.selectedProvider)) return props.selectedProvider as string;
  }
  return undefined;
}

export function hostFromScopes(scopes: readonly IconScope[]): string | undefined {
  for (const props of scopes) {
    const host = text(props.serverId) ?? text(props.agent?.serverId);
    if (host) return host;
  }
  return undefined;
}

/** Host-scoped routes: `/h/<serverId>/…` and `/settings/hosts/<serverId>/…`. */
export function hostFromPath(pathname: string): string | undefined {
  const route = /^\/(?:h|settings\/hosts)\/([^/]+)(?:\/|$)/.exec(pathname);
  if (!route) return undefined;
  try { return decodeURIComponent(route[1]); } catch { return route[1]; }
}
