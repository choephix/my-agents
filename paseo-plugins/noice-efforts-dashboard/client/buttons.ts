import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import type { Overview, WorkspaceInfo } from "../shared/rpc";
import { warmDetail } from "./data";
import { HeaderPie } from "./header-icon";
import { findEffort } from "./model";
import { EffortPopover } from "./popover";
import { latestOverview, onOverview, startOverviewWatch } from "./runtime";

/**
 * The icon-only header button's tooltip (and accessible name):
 * `acme-task · 0/9 done`, `No effort · suggested: acme-task`, or null when the
 * workspace shows nothing.
 */
function headerTitle(overview: Overview, workspace: WorkspaceInfo): string | null {
  const { binding, suggestion } = workspace;
  if (binding?.kind === "effort") {
    const effort = findEffort(overview, binding.root, binding.slug);
    if (!effort?.counts.total) return binding.slug;
    return `${binding.slug} · ${effort.counts.done}/${effort.counts.total} done`;
  }
  return !binding && suggestion ? `No effort · suggested: ${suggestion.slug}` : null;
}

/**
 * One icon-only header button per workspace (progress pie + chevron; popover option B), driven by
 * the live `overviewWatch` push subscription (also feeding sidebar row badges and Efforts surfaces).
 * Phone layouts list it as a row of the workspace ⋯ menu, which opens the same popover as a sheet.
 */
export function startButtons(client: PluginClientContext): () => void {
  /** What each registration shows now; `update` is only called when that changes. */
  const headers = new Map<string, { registration: PluginButtonRegistration; title: string; visible: boolean }>();

  const sync = () => {
    const overview = latestOverview();
    if (!overview) return;
    const byId = new Map(overview.workspaces.map((workspace) => [workspace.id, workspace]));
    for (const [id, header] of headers) {
      if (byId.has(id)) continue;
      header.registration.remove();
      headers.delete(id);
    }
    for (const workspace of overview.workspaces) {
      const title = overview.showHeaderButton ? headerTitle(overview, workspace) : null;
      // The popover is sized on its first frame, so its effort is read before it opens (and
      // refreshed whenever the pushed overview reports a newer `touchedMs`).
      if (workspace.binding?.kind === "effort") {
        const effort = findEffort(overview, workspace.binding.root, workspace.binding.slug);
        warmDetail(workspace.binding, effort?.touchedMs);
      }
      const current = headers.get(workspace.id);
      if (!title) {
        if (current?.visible) {
          current.registration.update({ visible: false });
          current.visible = false;
        }
        continue;
      }
      if (current) {
        if (current.title !== title || !current.visible) current.registration.update({ title, visible: true });
        current.title = title;
        current.visible = true;
        continue;
      }
      try {
        const registration = client.addHeaderButton({
          id: "effort",
          workspaceId: workspace.id,
          button: { title, icon: HeaderPie, behavior: { kind: "popover", Content: EffortPopover } },
        });
        headers.set(workspace.id, { registration, title, visible: true });
      } catch (error) {
        console.warn("[efforts] header button failed", error);
      }
    }
  };
  const offOverview = onOverview(sync);
  const stopWatch = startOverviewWatch(client);
  sync();

  return () => {
    stopWatch();
    offOverview();
    headers.forEach((header) => header.registration.remove());
  };
}
