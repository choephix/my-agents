import type { PluginWorkspaceRowBadgeItemProps } from "@getpaseo/plugin/client";
import { WorkspaceRowBadge, type WorkspaceRowBadgeTone } from "@getpaseo/plugin/client/ui";
import { useSyncExternalStore } from "react";
import type { Overview } from "../shared/rpc";
import { findEffort } from "./model";
import { latestOverview, onOverview } from "./runtime";

export interface RowBadgeData {
  label: string;
  tone: WorkspaceRowBadgeTone;
  accessibilityLabel: string;
}

/**
 * Sidebar meta-line badge for a workspace's bound effort: short name plus `done/total` when it has
 * tickets, in green once all tickets are done. Unbound workspaces (including suggestions) and
 * "No effort" return null so the sidebar stays quiet.
 */
export function rowBadgeFor(overview: Overview | null, workspaceId: string): RowBadgeData | null {
  const workspace = overview?.workspaces.find((candidate) => candidate.id === workspaceId);
  const binding = workspace?.binding;
  if (binding?.kind !== "effort") return null;
  const effort = findEffort(overview, binding.root, binding.slug);
  const name = effort?.short || binding.slug;
  if (!effort || effort.counts.total === 0) {
    return {
      label: name,
      tone: "muted",
      accessibilityLabel: `Effort ${binding.slug}`,
    };
  }
  const { done, total } = effort.counts;
  return {
    label: `${name} · ${done}/${total}`,
    tone: done >= total ? "success" : "muted",
    accessibilityLabel: `${binding.slug} · ${done}/${total} done`,
  };
}

/**
 * Renders the bound effort on a sidebar workspace row's meta line (toggleable in the sidebar's
 * Show menu). Reads the shared overview store, so idle unchanged polls trigger no re-renders.
 */
export function EffortRowBadge({ workspaceId }: PluginWorkspaceRowBadgeItemProps) {
  const overview = useSyncExternalStore(onOverview, latestOverview);
  const badge = rowBadgeFor(overview, workspaceId);
  if (!badge) return null;
  return <WorkspaceRowBadge icon="Map" label={badge.label} tone={badge.tone} accessibilityLabel={badge.accessibilityLabel} />;
}
