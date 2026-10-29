import test from "node:test";
import assert from "node:assert/strict";
import { PASEO_TITLE_WINDOW_MS, firstAgent, observeTitle, projectEntry, splitWorkspaces, workspaceOwnership } from "../shared/workspace-titles.mjs";
import { readable } from "../shared/agent-titles.mjs";
import { isDelegatedAgent } from "@getpaseo/protocol/agent-labels";

const PROMPT = "Why does the catalog table scroll during filtering?";
const created = (...titles) => titles.reduce((observed, [title, at]) => observeTitle(observed, title, at), { createdAt: 0, changes: [] });

test("observing a new workspace keeps its first title and each later different one", () => {
  const observed = created([PROMPT, 1], [PROMPT, 2], ["Fix catalog scrolling", 3], ["Fix catalog scrolling", 4], [null, 5]);
  assert.equal(observed.initial, PROMPT);
  assert.deepEqual(observed.changes, [{ title: "Fix catalog scrolling", at: 3 }, { title: null, at: 5 }]);
  assert.equal(created([null, 1]).initial, null);
});

test("Titles may name an empty or placeholder title, and keeps managing its own", () => {
  assert.equal(workspaceOwnership(null), "unnamed");
  assert.equal(workspaceOwnership(PROMPT, { placeholders: [PROMPT] }), "unnamed");
  assert.equal(workspaceOwnership("Frozen Columns", { chosen: "Frozen Columns" }), "named");
});

test("Paseo's generated title is the first change away from the placeholder, soon after creation", () => {
  const generated = "Fix catalog scrolling";
  const paseo = created([PROMPT, 0], [generated, 8_000]);
  assert.equal(workspaceOwnership(generated, { placeholders: [PROMPT], observed: paseo }), "paseo");
  // Created without a prompt line: an empty title is replaced the same way.
  assert.equal(workspaceOwnership(generated, { observed: created([null, 0], [generated, 8_000]) }), "paseo");
});

test("any other title is hand-named and never changed automatically", () => {
  const generated = "Fix catalog scrolling";
  // Renamed again after Paseo's title landed.
  const renamedAfter = created([PROMPT, 0], [generated, 8_000], ["Catalog UI", 20_000]);
  assert.equal(workspaceOwnership("Catalog UI", { placeholders: [PROMPT], observed: renamedAfter }), "hand");
  // A change long after creation.
  const late = created([PROMPT, 0], ["Catalog UI", PASEO_TITLE_WINDOW_MS + 1]);
  assert.equal(workspaceOwnership("Catalog UI", { placeholders: [PROMPT], observed: late }), "hand");
  // Paseo never replaces a title chosen at creation, so a change from one is Stefan's.
  const explicit = created(["Catalog", 0], ["Catalog UI", 5_000]);
  assert.equal(workspaceOwnership("Catalog UI", { placeholders: [PROMPT], observed: explicit }), "hand");
  assert.equal(workspaceOwnership("Catalog", { placeholders: [PROMPT], observed: explicit }), "hand");
  // Titles named it, then Stefan renamed it.
  assert.equal(workspaceOwnership("My Catalog Notes", { chosen: "Frozen Columns", placeholders: [PROMPT] }), "hand");
  // A workspace Titles didn't see created has no observed history.
  assert.equal(workspaceOwnership(generated, { placeholders: [PROMPT] }), "hand");
});

test("project siblings: Titles' own bare; placeholders and hand names carry a note", () => {
  assert.equal(projectEntry("Frozen Columns", "Frozen Columns"), "Frozen Columns");
  assert.deepEqual(projectEntry("Catalog UI", "Frozen Columns"), { title: "Catalog UI", note: "named by hand" });
  assert.deepEqual(projectEntry(PROMPT, null, [PROMPT]), { title: PROMPT, note: "placeholder: first prompt line, not a title" });
});

test("workspaces split into this project's (all) and other projects' (most recently active, capped)", () => {
  const at = minute => `2026-10-20T08:${String(minute).padStart(2, "0")}:00.000Z`;
  const self = { id: "self", projectId: "shop", title: null, activityAt: at(59) };
  const workspaces = [
    self,
    { id: "a", projectId: "shop", title: "Frozen Columns", activityAt: at(1) },
    { id: "b", projectId: "shop", title: "Product Import", activityAt: at(5) },
    { id: "c", projectId: "shop", title: null, activityAt: at(9) },
    { id: "d", projectId: "blog", projectDisplayName: "blog", projectCustomName: "Blog", title: "Review: RSS feed", activityAt: at(3) },
    { id: "e", projectId: "infra", projectDisplayName: "infra", title: "Review: Caddy", activityAt: at(7) },
    { id: "f", projectId: "infra", projectDisplayName: "infra", title: "Backups", activityAt: null },
  ];
  const { project, elsewhere } = splitWorkspaces(workspaces, self, 2);
  assert.deepEqual(project.map(workspace => workspace.id), ["b", "a"]);
  assert.deepEqual(elsewhere, [{ title: "Review: Caddy", project: "infra" }, { title: "Review: RSS feed", project: "Blog" }]);
});

test("a workspace's first agent is its earliest readable tab, archived ones included", () => {
  const loaded = { supportsStreaming: true };
  const agents = [
    { id: "generator", workspaceId: "w", internal: true, createdAt: "2026-10-20T08:00:00Z", labels: {}, capabilities: loaded },
    { id: "sub", workspaceId: "w", createdAt: "2026-10-20T08:00:01Z", labels: { "paseo.parent-agent-id": "second" }, capabilities: loaded },
    { id: "second", workspaceId: "w", createdAt: "2026-10-20T08:05:00Z", labels: {}, capabilities: loaded },
    { id: "first", workspaceId: "w", archivedAt: "2026-10-20T09:00:00Z", createdAt: "2026-10-20T08:00:02Z", labels: {}, capabilities: { supportsStreaming: false } },
    { id: "other", workspaceId: "x", createdAt: "2026-10-20T07:00:00Z", labels: {}, capabilities: loaded },
  ];
  // The same rule as server/workspaces.ts firstTab.
  const include = agent => !agent.internal && !isDelegatedAgent(agent) && readable(agent);
  assert.equal(firstAgent(agents, "w", include)?.id, "first");
  assert.equal(firstAgent(agents, "empty", include), null);
  // A stored live first tab can't be read without starting it, so the next readable tab stands in.
  const stored = agents.map(agent => agent.id === "first" ? { ...agent, archivedAt: undefined } : agent);
  assert.equal(firstAgent(stored, "w", include)?.id, "second");
});
