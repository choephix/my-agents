import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { useSyncExternalStore } from "react";
import { colorsOf, Pie } from "./marks";
import { findEffort } from "./model";
import { latestOverview, onOverview } from "./runtime";

/**
 * The header button's whole face: the bound effort's progress pie, or a dashed empty one while an
 * effort is only suggested. Reads the shared overview, so it redraws when the counts change.
 */
export function HeaderPie({ workspaceId, theme, size }: PluginButtonIconProps) {
  const overview = useSyncExternalStore(onOverview, latestOverview);
  const binding = overview?.workspaces.find((workspace) => workspace.id === workspaceId)?.binding;
  const counts = binding?.kind === "effort" ? findEffort(overview, binding.root, binding.slug)?.counts : undefined;
  return (
    <Pie
      done={counts?.done ?? 0}
      claimed={counts?.claimed ?? 0}
      total={counts?.total ?? 0}
      c={colorsOf(theme)}
      size={size}
      dashed={binding?.kind !== "effort"}
    />
  );
}
