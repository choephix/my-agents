import type { EffortSummary, Overview, Root, WorkspaceInfo } from "../shared/rpc";

/** Workspaces bound to an effort, and those it is only suggested for. */
export function workspacesOf(overview: Overview, effort: { root: string; slug: string }) {
  const bound: WorkspaceInfo[] = [];
  const suggested: WorkspaceInfo[] = [];
  for (const workspace of overview.workspaces) {
    if (workspace.binding?.kind === "effort" && workspace.binding.root === effort.root && workspace.binding.slug === effort.slug) bound.push(workspace);
    else if (!workspace.binding && workspace.suggestion?.root === effort.root && workspace.suggestion.slug === effort.slug) suggested.push(workspace);
  }
  return { bound, suggested };
}

/** `nilo` for a workspace of another project than the `.scratch` it uses (nilo's worktrees). */
export function chipPrefix(workspace: WorkspaceInfo, root: Root): string | undefined {
  return workspace.projectName !== root.label ? workspace.projectName : undefined;
}

export function findEffort(overview: Overview | undefined | null, root: string, slug: string): EffortSummary | null {
  return overview?.roots.find((candidate) => candidate.root === root)?.efforts.find((effort) => effort.slug === slug) ?? null;
}

/** The Next column: a ticket, or a short state word. */
export function nextText(effort: EffortSummary): { num?: string; text: string } {
  return effort.next ? { num: effort.next.num, text: effort.next.title } : { text: effort.stateWord };
}

/** Touched within the last week. */
export const WEEK_MS = 7 * 24 * 3600_000;
