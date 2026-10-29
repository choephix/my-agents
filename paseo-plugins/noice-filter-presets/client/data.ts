import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Project } from "../shared/presets";
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
