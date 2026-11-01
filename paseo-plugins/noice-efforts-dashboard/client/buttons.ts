import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { AppState } from "react-native";
import type { Overview, WorkspaceInfo } from "../shared/rpc";
import { warmDetail } from "./data";
import { HeaderPie } from "./header-icon";
import { findEffort } from "./model";
import { EffortPopover } from "./popover";
import { fetchOverview, latestOverview, latestOverviewAt, onOverview } from "./runtime";

/** Labels refresh this often in the background (the explorer tab polls every 5 s while visible). */
const REFRESH_MS = 30_000;

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
 * One icon-only header button per workspace (progress pie + chevron; popover option B). Phone
 * layouts list it as a row of the workspace ⋯ menu, which opens the same popover as a sheet.
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
      // The popover is sized on its first frame, so its effort is read before it opens.
      if (workspace.binding?.kind === "effort") warmDetail(workspace.binding);
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
  const refresh = () => void fetchOverview().catch((error: unknown) => console.warn("[efforts] overview failed", error));
  refresh();
  // Only when no surface polled lately: an open Efforts tab already refreshes every 5 s.
  const timer = setInterval(() => AppState.currentState === "active" && Date.now() - latestOverviewAt() >= REFRESH_MS - 1_000 && refresh(), REFRESH_MS);

  return () => {
    offOverview();
    clearInterval(timer);
    headers.forEach((header) => header.registration.remove());
  };
}
