import type { PaseoAgent, PaseoApi } from "@getpaseo/client";

// The daemon marks its own helper agents `internal`; the client's agent type omits the field.
export type ListedAgent = PaseoAgent & { internal?: boolean };

// Every agent, archived included: a workspace's first tab may be archived.
// Callers drop archived ones where they don't count.
export async function listAgents(paseo: PaseoApi): Promise<ListedAgent[]> {
  const all: ListedAgent[] = [];
  for (let cursor: string | undefined; ;) {
    // `includeBackground` is on the 0.12 wire schema but not in the client's option type.
    const options = { includeBackground: true, filter: { includeArchived: true }, ...(cursor ? { page: { limit: 200, cursor } } : {}) };
    const page = await paseo.agents.list(options);
    all.push(...page.entries.map(entry => entry.agent));
    cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
    if (!cursor) return all;
  }
}
