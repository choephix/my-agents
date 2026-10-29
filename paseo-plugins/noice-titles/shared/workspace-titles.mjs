// Workspace naming policy, pure and runtime-free. The agent-tab rules live in
// agent-titles.mjs; a workspace sibling is described to Haiku the same way.
import { LABEL_NAMED, siblingEntry } from "./agent-titles.mjs";

// Paseo names a new workspace in the background (workspace-auto-name.js) and
// applies that title only while the current one is empty or still the
// first-prompt placeholder. A first change away from such a title within this
// window is taken for Paseo's; later or further changes are Stefan's.
export const PASEO_TITLE_WINDOW_MS = 3 * 60_000;

// The titles a workspace showed since Titles saw it created: `initial` is the
// first one seen (undefined until then), `changes` every later different one.
export function observeTitle(observed, title, at) {
  if (observed.initial === undefined) return { ...observed, initial: title ?? null };
  const last = observed.changes.at(-1)?.title ?? observed.initial;
  return (title ?? null) === last ? observed : { ...observed, changes: [...observed.changes, { title: title ?? null, at }] };
}

// Whose the current title is:
// "named": the title Titles chose (`chosen`, from the ownership file);
// "unnamed": empty or Paseo's placeholder (one of `placeholders`, the first-prompt lines);
// "paseo": Paseo's generated title (see PASEO_TITLE_WINDOW_MS; needs `observed`);
// "hand": anything else, never changed automatically.
/** @param {string | null} title @param {{ chosen?: string | null, placeholders?: string[], observed?: { createdAt: number, initial?: string | null, changes: { title: string | null, at: number }[] } | null }} [options] */
export function workspaceOwnership(title, { chosen = null, placeholders = [], observed = null } = {}) {
  if (!title) return "unnamed";
  if (title === chosen) return "named";
  if (placeholders.includes(title)) return "unnamed";
  const [change, ...later] = observed?.changes ?? [];
  if (change && later.length === 0 && change.title === title && change.at - observed.createdAt <= PASEO_TITLE_WINDOW_MS
    && (!observed.initial || placeholders.includes(observed.initial))) return "paseo";
  return "hand";
}

// Another workspace of the same project as Haiku sees it: Titles' own title
// bare; a placeholder or a hand-chosen name with a note, as for sibling tabs.
export function projectEntry(title, chosen, placeholders = []) {
  return siblingEntry(title, chosen ? { [LABEL_NAMED]: chosen } : {}, placeholders);
}

const newestFirst = (a, b) => (b.activityAt ?? "").localeCompare(a.activityAt ?? "");

// The titled workspaces besides `self`, newest activity first: this project's
// all, the other projects' only the `limit` most recently active, each with
// its project's name.
export function splitWorkspaces(workspaces, self, limit = 40) {
  const others = workspaces.filter(workspace => workspace.id !== self.id && workspace.title).sort(newestFirst);
  return {
    project: others.filter(workspace => workspace.projectId === self.projectId),
    elsewhere: others.filter(workspace => workspace.projectId !== self.projectId).slice(0, limit)
      .map(workspace => ({ title: workspace.title, project: workspace.projectCustomName || workspace.projectDisplayName })),
  };
}

// The agent whose first prompt became the workspace's placeholder: its
// earliest tab, archived or not. `include` decides what counts (in the server:
// no internal or sub-agents, and only history readable without starting it).
export function firstAgent(agents, workspaceId, include) {
  return agents
    .filter(agent => agent.workspaceId === workspaceId && include(agent))
    .reduce((first, agent) => (!first || agent.createdAt < first.createdAt ? agent : first), null);
}
