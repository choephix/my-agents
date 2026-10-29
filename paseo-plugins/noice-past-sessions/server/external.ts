import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { ExternalProviderSchema, type listExternalSessions, type PastSession } from "../shared/rpc";
import { scopeContext, transcriptFile, withPreviews } from "./list";
import { cleanTitle, titleFromPrompt } from "./merge";
import { resolvedOrSelf } from "./omp-sessions";
import { withDaemonClient, type RecentProviderSession } from "./paseo-cli";
import { isSameOrInside } from "./slug";

/** The daemon caps each listing at 200; one unscoped call per provider covers every folder. */
const LIMIT = 200;

export interface ExternalCandidate {
  provider: string;
  sessionId: string;
  /** Resolved cwd. */
  cwd: string;
  title: string | null;
  firstPrompt: string | null;
  lastActivityAt: string;
}

/** Providers to list: Claude Code and Codex unless the daemon config disables them. */
export function externalProviders(providers: Record<string, unknown>): ("claude" | "codex")[] {
  return ExternalProviderSchema.options.filter((id) => {
    const entry = providers[id];
    return !(entry && typeof entry === "object" && "enabled" in entry && entry.enabled === false);
  });
}

/**
 * Sessions of the daemon listing that belong to the scope and that no Paseo agent owns. The
 * daemon already drops sessions it has imported; `knownRefs` repeats that check against the
 * agents this list saw, so a session imported since the cached listing disappears at once.
 */
export function externalInScope(
  candidates: ExternalCandidate[],
  scope: { targets: string[]; includeSubfolders: boolean; knownRefs: ReadonlySet<string> },
  home: string,
): PastSession[] {
  const seen = new Set<string>();
  const entries: PastSession[] = [];
  for (const candidate of candidates) {
    const key = `ext:${candidate.provider}:${candidate.sessionId}`;
    if (seen.has(key) || scope.knownRefs.has(candidate.sessionId)) continue;
    const inScope = scope.includeSubfolders
      ? scope.targets.some((target) => isSameOrInside(target, candidate.cwd))
      : scope.targets.includes(candidate.cwd);
    if (!inScope) continue;
    seen.add(key);
    const file = transcriptFile({ provider: candidate.provider, sessionId: candidate.sessionId }, candidate.cwd, home);
    entries.push({
      key,
      source: "external",
      title: cleanTitle(candidate.title) || cleanTitle(titleFromPrompt(candidate.firstPrompt)) || "Empty session",
      cwd: candidate.cwd,
      at: candidate.lastActivityAt,
      provider: candidate.provider,
      sessionId: candidate.sessionId,
      ...(file ? { file } : {}),
      preview: null,
    });
  }
  return entries;
}

interface Listing {
  candidates: ExternalCandidate[];
  fetchedAt: string;
  warnings: string[];
}

let cached: { providers: string; listing: Promise<Listing> } | null = null;

async function fetchListing(providers: string[]): Promise<Listing> {
  const fetchedAt = new Date().toISOString();
  const results = await withDaemonClient((client) =>
    // One call per provider: a combined call shares the 200 limit, and Claude would crowd out Codex.
    Promise.all(providers.map((provider) => client.fetchRecentProviderSessions({ providers: [provider], limit: LIMIT }))),
  );
  const raw: RecentProviderSession[] = results.flatMap((result) => result.entries);
  const candidates = await Promise.all(
    raw.map(async (entry) => ({
      provider: entry.providerId,
      sessionId: entry.providerHandleId,
      cwd: await resolvedOrSelf(entry.cwd),
      title: entry.title,
      firstPrompt: entry.firstPromptPreview,
      lastActivityAt: entry.lastActivityAt,
    })),
  );
  const warnings = results.flatMap((result) =>
    (result.providerErrors ?? []).map((error) => `${error.provider}: ${error.message}`),
  );
  return { candidates, fetchedAt, warnings };
}

/** The daemon listing, taken once and reused until a refresh; a failed listing is not kept. */
function listing(providers: string[], refresh: boolean): Promise<Listing> {
  const key = providers.join(",");
  if (refresh || cached?.providers !== key) {
    const pending = fetchListing(providers);
    cached = { providers: key, listing: pending };
    pending.catch(() => {
      if (cached?.listing === pending) cached = null;
    });
  }
  return cached!.listing;
}

export async function externalHandler(
  input: RpcInput<typeof listExternalSessions>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof listExternalSessions>> {
  const started = performance.now();
  const context = await scopeContext(paseo, input.workspaceId, input.scope);
  const providers = externalProviders(context.providers);
  const { candidates, fetchedAt, warnings } = await listing(providers, input.refresh);
  const entries = externalInScope(
    candidates,
    {
      targets: context.targets,
      includeSubfolders: context.includeSubfolders,
      knownRefs: new Set(context.agents.flatMap((agent) => agent.sessionRefs)),
    },
    context.home,
  );
  return {
    entries: await withPreviews(entries),
    providers,
    fetchedAt,
    elapsedMs: Math.round(performance.now() - started),
    warnings: [...context.warnings, ...warnings],
  };
}
