// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Project } from "../shared/presets";
import { applyWorkspaceUpdate, createSidebarFilter, sidebarCss } from "../client/web";

// vi.mock is hoisted above the imports; react-native itself does not load outside a bundler.
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

const host = "srv_test";
const project = (projectId: string, projectKey: string): Project => ({
  projectId, projectKey, projectRootPath: `/home/user/workspace/${projectId}`, projectDisplayName: projectId,
});
const nilo = project("prj_acme", "remote:github.com/acme/acme-app");
const game = project("prj_game", "/home/user/workspace/acme-game");
const projects = [nilo, game];
const row = (workspaceId: string) => `<button data-testid="sidebar-workspace-row-${host}:${workspaceId}"></button>`;

// The shape of Paseo 0.12's web sidebar: a Pinned list outside any group, project groups, status sections.
function renderSidebar(grouping: "project" | "status") {
  const pinned = `<div>Pinned</div><div>${row("wks_pinned_game")}</div>`;
  const body = grouping === "project"
    ? `<div role="group"><div data-testid='sidebar-project-row-${nilo.projectKey}'></div>${row("wks_nilo")}</div>`
      + `<div role="group"><div data-testid='sidebar-project-row-${game.projectKey}'></div>${row("wks_game")}</div>`
    : `<div id="running"><div>Working</div><div data-testid="sidebar-status-group-rows-running">${row("wks_nilo")}${row("wks_game")}</div></div>`
      + `<div id="done"><div>Done</div><div data-testid="sidebar-status-group-rows-done">${row("wks_game_2")}</div></div>`;
  document.body.innerHTML = pinned + body;
}

function hiddenTestIds(css: string): string[] {
  const selectors = css.replace(/ \{ display: none !important; \}$/, "");
  if (!selectors) return [];
  return [...document.querySelectorAll(selectors)].map((element) => element.getAttribute("data-testid") ?? element.id ?? "");
}

const workspaces = [
  { id: "wks_pinned_game", projectId: "prj_game" },
  { id: "wks_nilo", projectId: "prj_acme" },
  { id: "wks_game", projectId: "prj_game" },
  { id: "wks_game_2", projectId: "prj_game" },
];

describe("hiding the game project (company preset selected)", () => {
  const css = sidebarCss(host, projects, [game], workspaces);

  beforeEach(() => { document.body.innerHTML = ""; });

  test("group by project hides the game group, keeps the pinned row", () => {
    renderSidebar("project");
    const hidden = document.querySelectorAll(css.replace(/ \{.*$/s, ""));
    expect([...hidden].map((element) => element.querySelector("[data-testid^='sidebar-project-row-']")?.getAttribute("data-testid")))
      .toEqual([`sidebar-project-row-${game.projectKey}`]);
    expect(hiddenTestIds(css)).not.toContain(`sidebar-workspace-row-${host}:wks_pinned_game`);
  });

  test("group by status hides game rows and the section they empty, keeps the pinned row", () => {
    renderSidebar("status");
    expect(hiddenTestIds(css).sort()).toEqual([
      "done",
      `sidebar-workspace-row-${host}:wks_game`,
      `sidebar-workspace-row-${host}:wks_game_2`,
    ]);
  });
});

describe("workspace updates", () => {
  const start = [{ id: "wks_nilo", projectId: "prj_acme" }];

  test("a workspace created in a hidden project gets hidden", () => {
    const next = applyWorkspaceUpdate(start, { kind: "upsert", workspace: { id: "wks_new", projectId: "prj_game" } });
    renderSidebar("status");
    document.querySelector("[data-testid='sidebar-status-group-rows-running']")!.insertAdjacentHTML("beforeend", row("wks_new"));
    expect(hiddenTestIds(sidebarCss(host, projects, [game], next))).toContain(`sidebar-workspace-row-${host}:wks_new`);
  });

  test("status-only updates keep the same list, so the stylesheet is not rebuilt", () => {
    expect(applyWorkspaceUpdate(start, { kind: "upsert", workspace: { id: "wks_nilo", projectId: "prj_acme" } })).toBe(start);
    expect(applyWorkspaceUpdate(start, { kind: "remove", id: "wks_unknown" })).toBe(start);
  });

  test("archived workspaces drop out and moved ones follow their project", () => {
    expect(applyWorkspaceUpdate(start, { kind: "remove", id: "wks_nilo" })).toEqual([]);
    expect(applyWorkspaceUpdate(start, { kind: "upsert", workspace: { id: "wks_nilo", projectId: "prj_game" } }))
      .toEqual([{ id: "wks_nilo", projectId: "prj_game" }]);
  });
});

describe("the last filter is shown at page load", () => {
  const sheets = () => [...document.head.querySelectorAll("style")].map((style) => style.textContent ?? "").filter(Boolean);
  const css = sidebarCss(host, projects, [game], workspaces);

  beforeEach(() => {
    document.head.innerHTML = "";
    localStorage.clear();
    history.replaceState(null, "", `/h/${host}/workspace/wks_nilo`);
  });

  test("a reload shows the route host's last sheet until the switcher applies the current one", () => {
    const first = createSidebarFilter();
    first.apply(css, host);
    first.remove();
    expect(sheets()).toEqual([]);

    const afterReload = createSidebarFilter();
    expect(sheets()).toEqual([css]);
    afterReload.apply("", host); // switched to All
    expect(sheets()).toEqual([]);
    afterReload.remove();
    createSidebarFilter();
    expect(sheets()).toEqual([]);
  });

  test("another host's sheet is not shown, and one host installation per host shows it once", () => {
    createSidebarFilter().apply(css, host);
    createSidebarFilter().apply("[data-testid=x] { display: none !important; }", "srv_other");
    document.head.innerHTML = "";
    createSidebarFilter();
    createSidebarFilter();
    expect(sheets()).toEqual([css]);
  });

  test("a failed load clears the cached sheet without forgetting it", () => {
    createSidebarFilter().apply(css, host);
    document.head.innerHTML = "";
    createSidebarFilter().apply("");
    expect(sheets()).toEqual([]);
    document.head.innerHTML = "";
    createSidebarFilter();
    expect(sheets()).toEqual([css]);
  });
});
