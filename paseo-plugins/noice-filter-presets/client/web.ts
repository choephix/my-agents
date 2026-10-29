import { Platform } from "react-native";
import type { Project } from "../shared/presets";

interface StyleElement {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}
declare const document: {
  createElement(tag: "style"): StyleElement;
  querySelector(selector: string): StyleElement | null;
  head: { appendChild(element: StyleElement): void };
};
declare const location: { pathname: string };
declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
const storageKey = "paseo-plugin:filter-presets:selected";
// Last stylesheet per host, applied before the definitions and projects arrive after a page load.
const cssCacheKey = "paseo-plugin:filter-presets:css";

export function readSelection(): string {
  if (Platform.OS !== "web") return "all";
  try { return localStorage.getItem(storageKey) || "all"; } catch { return "all"; }
}

export function writeSelection(id: string): void {
  if (Platform.OS !== "web") return;
  try { localStorage.setItem(storageKey, id); } catch { /* Private browsing can deny storage. */ }
}

export interface WorkspaceRef { id: string; projectId: string }

type WorkspaceUpdate =
  | { kind: "upsert"; workspace: { id: string; projectId: string } }
  | { kind: "remove"; id: string };

/** Applies one workspace_update; returns the same array when nothing the filter uses changed (status-only updates). */
export function applyWorkspaceUpdate(current: WorkspaceRef[], update: WorkspaceUpdate): WorkspaceRef[] {
  if (update.kind === "remove") {
    return current.some(({ id }) => id === update.id) ? current.filter(({ id }) => id !== update.id) : current;
  }
  const { id, projectId } = update.workspace;
  const index = current.findIndex((workspace) => workspace.id === id);
  if (index === -1) return [...current, { id, projectId }];
  if (current[index].projectId === projectId) return current;
  return current.map((workspace, i) => i === index ? { id, projectId } : workspace);
}

/** The stylesheet that hides `hidden` projects of host `hostId` in both sidebar groupings. */
export function sidebarCss(hostId: string, projects: Project[], hidden: Project[], workspaces: WorkspaceRef[]): string {
  const hiddenIds = new Set(hidden.map((project) => project.projectId));
  const visibleKeys = new Set(projects.filter((project) => !hiddenIds.has(project.projectId)).map((project) => project.projectKey));
  const selectors = new Set<string>();
  for (const project of hidden) {
    // 0.12 uses host/project-ID view keys when several projects share a remote.
    const keys = [JSON.stringify([hostId, project.projectId])];
    if (project.projectKey && !visibleKeys.has(project.projectKey)) {
      keys.push(project.projectKey);
    }
    for (const key of keys) {
      const testId = JSON.stringify("sidebar-project-row-" + key);
      // Hide the enclosing project group, not just its header. No host style is mutated.
      selectors.add(`[role="group"]:has([data-testid=${testId}])`);
    }
  }
  // "Group by status" lists workspace rows without project groups; hide those rows one by one. Only inside status
  // sections: pinned rows use the same test ID, and hiding them would leave a bare "Pinned" heading.
  const hiddenRows: string[] = [];
  for (const workspace of workspaces) {
    if (!hiddenIds.has(workspace.projectId)) continue;
    const row = `[data-testid=${JSON.stringify(`sidebar-workspace-row-${hostId}:${workspace.id}`)}]`;
    hiddenRows.push(row);
    selectors.add(`[data-testid^="sidebar-status-group-rows-"] ${row}`);
  }
  if (hiddenRows.length) {
    // A status section (header + rows list) whose every row is hidden would show a bare heading.
    // Sections with "Show more" stay: their unrendered rows may match.
    selectors.add(`div:has(> [data-testid^="sidebar-status-group-rows-"])`
      + `:not(:has([data-testid^="sidebar-workspace-row-"]:not(${hiddenRows.join(",")})))`
      + `:not(:has([data-testid^="sidebar-status-group-show-more-"]))`);
  }
  return selectors.size ? [...selectors].join(",\n") + " { display: none !important; }" : "";
}

export interface SidebarFilter {
  /** Shows `css`; with `hostId` it is also remembered for the next page load. */
  apply(css: string, hostId?: string): void;
  remove(): void;
}

function readCssCache(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(cssCacheKey) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
  } catch { return {}; }
}

const bootSelector = 'style[data-plugin="noice-filter-presets-boot"]';

/**
 * Shows the route host's last sheet until a switcher applies the current one (about a second after a page load).
 * One shared element: every host's installation runs this, but only the route host's switcher mounts to clear it.
 */
function showBootSheet(): void {
  if (document.querySelector(bootSelector)) return;
  const cache = readCssCache();
  const routeHost = /^\/h\/([^/]+)/.exec(location.pathname)?.[1];
  const hosts = Object.keys(cache);
  const css = routeHost !== undefined ? cache[routeHost] : hosts.length === 1 ? cache[hosts[0]] : undefined;
  if (!css) return;
  const boot = document.createElement("style");
  boot.setAttribute("data-plugin", "noice-filter-presets-boot");
  boot.textContent = css;
  document.head.appendChild(boot);
}

export function createSidebarFilter(): SidebarFilter {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return { apply() {}, remove() {} };
  }
  showBootSheet();
  const style = document.createElement("style");
  style.setAttribute("data-plugin", "noice-filter-presets");
  document.head.appendChild(style);
  return {
    apply(css: string, hostId?: string) {
      document.querySelector(bootSelector)?.remove();
      // An identical sheet would still cost the browser a full style recalculation.
      if (style.textContent !== css) style.textContent = css;
      if (hostId === undefined) return;
      const cache = readCssCache();
      if ((cache[hostId] ?? "") === css) return;
      if (css) cache[hostId] = css; else delete cache[hostId];
      try {
        if (Object.keys(cache).length) localStorage.setItem(cssCacheKey, JSON.stringify(cache));
        else localStorage.removeItem(cssCacheKey);
      } catch { /* Private browsing can deny storage. */ }
    },
    remove() {
      document.querySelector(bootSelector)?.remove();
      style.remove();
    },
  };
}
