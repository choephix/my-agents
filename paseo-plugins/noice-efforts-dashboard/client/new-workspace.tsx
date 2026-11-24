import { useNewWorkspace, useRpc, type PluginNewWorkspace } from "@getpaseo/plugin/client";
import { Combobox, type ComboboxItem } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NEW_WORKSPACE_EFFORT_KEY,
  parseNewWorkspaceEffort,
  projectEffortsRpc,
  type ProjectEffort,
} from "../shared/new-workspace";
import type { Overview } from "../shared/rpc";
import { age } from "./format";
import { latestOverview } from "./runtime";

export const CLEAR_EFFORT_ID = "__clear__";
export const NONE_EFFORT_ID = "__none__";

export type EffortComboboxOption =
  | (ComboboxItem & { kind: "clear" })
  | (ComboboxItem & { kind: "none" })
  | (ComboboxItem & { kind: "effort"; root: string; slug: string });

/** Current Combobox value derived from the New workspace setup's metadata. */
export function selectedEffortValue(metadata: Readonly<Record<string, unknown>> | null | undefined): ComboboxItem | null {
  const choice = parseNewWorkspaceEffort(metadata);
  if (!choice) return null;
  if (choice.kind === "none") return { id: NONE_EFFORT_ID, label: "No effort" };
  return { id: `${choice.root}/${choice.slug}`, label: choice.label || choice.slug };
}

function normalizeName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Compact one-line description for an effort option: counts/status, age, optional root and title. */
export function effortOptionDescription(
  effort: ProjectEffort,
  options?: { multiRoot?: boolean; now?: number },
): string {
  const parts: string[] = [];
  if (effort.counts.total > 0) parts.push(`${effort.counts.done}/${effort.counts.total} done`);
  else parts.push(effort.hasMap ? "map only" : "no map");
  if (effort.mapStatus) parts.push(effort.mapStatus);
  parts.push(age(effort.touchedMs, options?.now));
  if (options?.multiRoot && effort.rootLabel) parts.push(effort.rootLabel);
  if (effort.title) {
    const normTitle = normalizeName(effort.title);
    if (normTitle && normTitle !== normalizeName(effort.short) && normTitle !== normalizeName(effort.slug)) {
      parts.push(effort.title);
    }
  }
  return parts.join(" · ");
}

/** Builds the Combobox option list, adding Clear when selected and No effort as an explicit opt-out. */
export function buildEffortOptions(input: {
  efforts: readonly ProjectEffort[];
  rootCount: number;
  query: string;
  selected: ComboboxItem | null;
  now?: number;
}): EffortComboboxOption[] {
  const trimmed = input.query.trim().toLowerCase();
  const options: EffortComboboxOption[] = [];
  if (input.selected && trimmed === "") {
    options.push({
      id: CLEAR_EFFORT_ID,
      kind: "clear",
      label: "Clear effort",
      description: "Leave this workspace unbound",
    });
  }
  const multiRoot = input.rootCount > 1;
  for (const effort of input.efforts) {
    options.push({
      id: effort.key,
      kind: "effort",
      root: effort.root,
      slug: effort.slug,
      label: effort.short || effort.slug,
      description: effortOptionDescription(effort, { multiRoot, now: input.now }),
    });
  }
  if (input.selected?.id !== NONE_EFFORT_ID && (trimmed === "" || "no effort".includes(trimmed))) {
    options.push({
      id: NONE_EFFORT_ID,
      kind: "none",
      label: "No effort",
      description: "Don't suggest an effort for this workspace",
    });
  }
  return options;
}

/**
 * Synchronous hint from the already-loaded overview so projects with known efforts show the
 * Combobox on the first frame without waiting for the mount RPC.
 */
export function projectLikelyHasEfforts(overview: Overview | null, projectName: string | null): boolean {
  if (!overview || !projectName) return false;
  if (overview.workspaces.some((workspace) => workspace.projectName === projectName && workspace.root !== null)) return true;
  return overview.roots.some((root) => root.efforts.length > 0 && root.label === projectName);
}

/** New workspace screen field: binds the created workspace to an effort via workspace metadata. */
export function EffortNewWorkspaceField() {
  const newWorkspace = useNewWorkspace();
  if (!newWorkspace.project) return null;
  return <ProjectEffortField newWorkspace={newWorkspace} project={newWorkspace.project} />;
}

function ProjectEffortField({
  newWorkspace,
  project,
}: {
  newWorkspace: PluginNewWorkspace;
  project: { readonly id: string; readonly name: string };
}) {
  const fetchProjectEfforts = useRpc(projectEffortsRpc);
  const value = useMemo(() => selectedEffortValue(newWorkspace.metadata), [newWorkspace.metadata]);
  const [hasEfforts, setHasEfforts] = useState(() => Boolean(value) || projectLikelyHasEfforts(latestOverview(), project.name));

  useEffect(() => {
    let active = true;
    fetchProjectEfforts({ projectId: project.id, query: "" })
      .then((result) => {
        if (active) setHasEfforts(result.hasEfforts);
      })
      .catch(() => {
        // Keep whatever visibility we already had if the host is momentarily unavailable.
      });
    return () => {
      active = false;
    };
  }, [fetchProjectEfforts, project.id]);

  const search = useCallback(
    async ({ query }: { query: string }): Promise<EffortComboboxOption[]> => {
      const result = await fetchProjectEfforts({ projectId: project.id, query });
      setHasEfforts(result.hasEfforts);
      return buildEffortOptions({
        efforts: result.efforts,
        rootCount: result.rootCount,
        query,
        selected: value,
      });
    },
    [fetchProjectEfforts, project.id, value],
  );

  const onSelect = useCallback(
    async ({ item }: { item: EffortComboboxOption }) => {
      if (item.kind === "clear") {
        await newWorkspace.setMetadata({ [NEW_WORKSPACE_EFFORT_KEY]: null });
        return;
      }
      if (item.kind === "none") {
        await newWorkspace.setMetadata({ [NEW_WORKSPACE_EFFORT_KEY]: { kind: "none" } });
        return;
      }
      await newWorkspace.setMetadata({
        [NEW_WORKSPACE_EFFORT_KEY]: {
          kind: "effort",
          root: item.root,
          slug: item.slug,
          label: item.label,
        },
      });
    },
    [newWorkspace],
  );

  if (!hasEfforts && !value) return null;
  return <Combobox title="Effort" icon="Map" value={value} search={search} onSelect={onSelect} />;
}
