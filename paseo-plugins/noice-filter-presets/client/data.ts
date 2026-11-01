import { useSettings, type PluginClientContext } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { compilePreset, preferences, type Project } from "../shared/presets";
import { applyWorkspaceUpdate, type WorkspaceRef } from "./web";

/** Projects of the host. Fresh for 30 s (opening settings reuses the sidebar's list); `project.update` refetches at once. */
export function useProjects(client: PluginClientContext, hostId: string) {
  const queryClient = useQueryClient();
  const projects = useQuery({
    queryKey: ["filter-presets-projects", hostId],
    queryFn: async (): Promise<Project[]> => (await client.paseo.projects.list()).projects,
    staleTime: 30_000,
  });
  useEffect(() => client.paseo.projects.subscribe(() => {
    // The switcher and the settings screen both listen; a fetch already running is reused, not repeated.
    void queryClient.invalidateQueries({ queryKey: ["filter-presets-projects", hostId] }, { cancelRefetch: false });
  }), [client, queryClient, hostId]);
  return projects;
}

export interface Choice { id: string; name: string }
export interface PresetChoices {
  projects: Project[];
  /** All, each preset, and Other when some project matches no preset. */
  choices: Choice[];
  /** The projects choice `id` shows; every project for All or an unknown id. */
  shown(id: string): Project[];
}

/** The host's presets matched against its projects: `data` once both have loaded; `failed` when either can't. */
export function usePresetChoices(client: PluginClientContext, hostId: string): { data?: PresetChoices; failed: boolean } {
  const settings = useSettings(preferences);
  const projects = useProjects(client, hostId);
  const presets = settings.status === "ready" ? settings.values.presets : undefined;
  const data = useMemo(() => {
    if (!presets || !projects.data) return undefined;
    const all = projects.data;
    const groups = presets.map((preset) => ({ id: preset.id, name: preset.name, matches: compilePreset(preset) }));
    const other = all.filter((project) => !groups.some((group) => group.matches(project)));
    return {
      projects: all,
      choices: [{ id: "all", name: "All" }, ...groups.map(({ id, name }) => ({ id, name })), ...(other.length ? [{ id: "other", name: "Other" }] : [])],
      shown(id: string) {
        if (id === "other") return other;
        const group = groups.find((candidate) => candidate.id === id);
        return group ? all.filter(group.matches) : all;
      },
    };
  }, [presets, projects.data]);
  return { data, failed: projects.isError || settings.status === "error" || settings.status === "invalid" };
}

/**
 * Workspace id → project id for active workspaces: the first 200, plus any the subscription reports later (archived ones leave).
 * `workspaces.subscribe` alone never fires: the daemon streams workspace updates only to a subscribed list.
 */
export function useWorkspaceRefs(client: PluginClientContext, hostId: string): WorkspaceRef[] | undefined {
  const [workspaces, setWorkspaces] = useState<WorkspaceRef[]>();
  useEffect(() => {
    let live = true;
    let release = () => {};
    const refs = (entries: { id: string; projectId: string }[]) => entries.map(({ id, projectId }) => ({ id, projectId }));
    void client.paseo.workspaces.list({ page: { limit: 200 }, subscribe: {} }).then((result) => {
      const { subscription } = result;
      if (!live) { void subscription.release(); return; }
      const off = subscription.subscribe({
        // Snapshots come again after every reconnect.
        snapshot: (snapshot) => setWorkspaces(refs(snapshot.entries)),
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const update = message.payload;
          setWorkspaces((current) => current && applyWorkspaceUpdate(current, update.kind === "remove"
            ? { kind: "remove", id: update.id }
            : { kind: "upsert", workspace: update.workspace }));
        },
      });
      release = () => { off(); void subscription.release(); };
      setWorkspaces(refs(result.entries));
    }).catch((error: unknown) => {
      // Project groups can still be hidden; only "group by status" rows need this list.
      console.error("noice-filter-presets: workspace list failed", error);
      if (live) setWorkspaces((current) => current ?? []);
    });
    return () => { live = false; release(); };
  }, [client, hostId]);
  return workspaces;
}
