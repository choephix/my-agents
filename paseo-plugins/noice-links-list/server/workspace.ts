import { PARENT_LABEL } from "./subagents";

export interface ListedAgent {
  id: string;
  workspaceId?: string;
  labels: Readonly<Record<string, string>>;
  internal?: boolean;
}

/**
 * A workspace's tabs and the agents folded into each, following Paseo's root policy
 * (`app/src/subagents/workspace-root-policy.ts`): an agent is a tab unless it has a parent in the
 * same workspace. A child whose parent is gone is no tab in Paseo either, so it is left out.
 * Grandchildren fold into the tab at the top of their chain. Order follows `agents`.
 */
export function workspaceTree<Agent extends ListedAgent>(agents: readonly Agent[], workspaceId: string): { root: Agent; children: Agent[] }[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const inWorkspace = agents.filter((agent) => agent.workspaceId === workspaceId && !agent.internal);
  /** The tab an agent belongs to, or null when its chain breaks off. */
  const rootOf = (agent: Agent): Agent | null => {
    const seen = new Set<string>();
    let current = agent;
    for (;;) {
      const parentId = current.labels[PARENT_LABEL];
      if (!parentId) return current;
      const parent = byId.get(parentId);
      if (!parent || seen.has(parentId)) return null;
      if (parent.workspaceId !== workspaceId) return current;
      seen.add(parentId);
      current = parent;
    }
  };
  const tabs = new Map<string, { root: Agent; children: Agent[] }>();
  for (const agent of inWorkspace) {
    if (rootOf(agent) === agent) tabs.set(agent.id, { root: agent, children: [] });
  }
  for (const agent of inWorkspace) {
    const root = rootOf(agent);
    if (root && root !== agent) tabs.get(root.id)?.children.push(agent);
  }
  return [...tabs.values()];
}
