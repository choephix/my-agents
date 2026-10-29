import { z } from "zod";
import type { DotOrder, ShowMode } from "../shared/preferences";

/** The part of an `agents.list` agent the dots need; unknown fields pass through. */
const AgentSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string().nullish(),
  status: z.string(),
  requiresAttention: z.boolean().nullish(),
  attentionReason: z.string().nullish(),
  pendingPermissions: z.array(z.unknown()).nullish(),
  labels: z.record(z.string(), z.string()).nullish(),
  attentionTimestamp: z.string().nullish(),
  updatedAt: z.string().nullish(),
});

export interface AgentInfo {
  id: string;
  workspaceId: string;
  parentId: string | null;
  title: string | null;
  status: string;
  requiresAttention: boolean;
  attentionReason: string | null;
  pendingPermissions: number;
  /** ISO time it started wanting attention, else its last update. */
  at: string | null;
}

/** Paseo's sidebar bucket order (protocol `agent-state-bucket.ts`): permission, error, running, unread, read. */
export type DotState = "permission" | "error" | "running" | "finished" | "read";

export interface Dot {
  agentId: string;
  title: string;
  state: DotState;
}

export interface RowDots {
  dots: Dot[];
  /** Tabs left out because the row is full. */
  more: number;
}

/** Reads an `agents.list` entry agent; null when it lacks the fields above. */
export function readAgent(raw: unknown): AgentInfo | null {
  const parsed = AgentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const agent = parsed.data;
  return {
    id: agent.id,
    workspaceId: agent.workspaceId,
    parentId: agent.labels?.["paseo.parent-agent-id"] || null,
    title: agent.title?.trim() || null,
    status: agent.status,
    requiresAttention: agent.requiresAttention === true,
    attentionReason: agent.attentionReason ?? null,
    pendingPermissions: agent.pendingPermissions?.length ?? 0,
    at: agent.attentionTimestamp ?? agent.updatedAt ?? null,
  };
}

/**
 * A tab is a root agent: no parent, or a parent in another workspace. A child whose parent is
 * unknown is not a root (Paseo's `workspace-root-policy.ts`).
 */
export function rootsByWorkspace(agents: ReadonlyMap<string, AgentInfo>): Map<string, AgentInfo[]> {
  const roots = new Map<string, AgentInfo[]>();
  for (const agent of agents.values()) {
    if (agent.parentId) {
      const parent = agents.get(agent.parentId);
      if (!parent || parent.workspaceId === agent.workspaceId) continue;
    }
    const list = roots.get(agent.workspaceId);
    if (list) list.push(agent);
    else roots.set(agent.workspaceId, [agent]);
  }
  return roots;
}

export function dotState(agent: AgentInfo): DotState {
  if (agent.pendingPermissions > 0 || (agent.requiresAttention && agent.attentionReason === "permission")) {
    return "permission";
  }
  if (agent.status === "error" || (agent.requiresAttention && agent.attentionReason === "error")) return "error";
  if (agent.status === "running" || agent.status === "initializing") return "running";
  if (agent.requiresAttention) return "finished";
  return "read";
}

/** Pane tree of the app's persisted `workspace-layout-state` (app `workspace-layout-storage.ts`). */
type LayoutNode =
  | { kind: "pane"; pane: { tabIds: string[] } }
  | { kind: "group"; group: { children: LayoutNode[] } };
const LayoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("pane"), pane: z.object({ tabIds: z.array(z.string()) }) }),
    z.object({ kind: z.literal("group"), group: z.object({ children: z.array(LayoutNodeSchema) }) }),
  ]),
);
const LayoutStateSchema = z.object({
  state: z.object({ layoutByWorkspace: z.record(z.string(), z.unknown()) }),
});
const WorkspaceLayoutSchema = z.object({ root: LayoutNodeSchema });

/**
 * Agent ids per layout key (`<serverId>:<workspaceId>`), panes walked depth-first in `tabIds`
 * order (the app's `collectAllTabs`). Unreadable storage or workspaces yield no entry, so
 * callers fall back to id order.
 */
export function readLayoutOrder(raw: string | null): Map<string, string[]> {
  const order = new Map<string, string[]>();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    return order;
  }
  const state = LayoutStateSchema.safeParse(json);
  if (!state.success) return order;
  for (const [key, value] of Object.entries(state.data.state.layoutByWorkspace)) {
    const layout = WorkspaceLayoutSchema.safeParse(value);
    if (!layout.success) continue;
    const ids: string[] = [];
    const walk = (node: LayoutNode) => {
      if (node.kind === "group") {
        node.group.children.forEach(walk);
        return;
      }
      for (const tabId of node.pane.tabIds) if (tabId.startsWith("agent_")) ids.push(tabId.slice(6));
    };
    walk(layout.data.root);
    order.set(key, ids);
  }
  return order;
}

/** Layout order first, then tabs the layout lacks sorted by id (what the app appends on next open). */
export function orderTabs(roots: readonly AgentInfo[], layoutIds: readonly string[] | undefined): AgentInfo[] {
  const byId = new Map(roots.map((agent) => [agent.id, agent]));
  const ordered: AgentInfo[] = [];
  for (const id of layoutIds ?? []) {
    const agent = byId.get(id);
    if (!agent) continue;
    ordered.push(agent);
    byId.delete(id);
  }
  const rest = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return ordered.concat(rest);
}

/**
 * Dots for one row, in tab order or, with `order` "waiting", tabs waiting on the user first
 * (permission, unread result, unread error), then running ones, then read ones, each group in tab
 * order. When more tabs qualify than `max`, the same ranking picks which ones stay; the rest count
 * into `more`.
 */
export function rowDots(tabs: readonly AgentInfo[], show: ShowMode, max: number, order: DotOrder): RowDots {
  const candidates = tabs.flatMap((agent, index) => {
    const state = dotState(agent);
    const wanted = wantsYou(agent, state);
    const visible = show === "all" || wanted || (show === "unread-running" && state === "running");
    const rank = wanted ? 0 : state === "running" ? 1 : 2;
    return visible ? [{ agent, state, index, rank }] : [];
  });
  const byRank = (a: { rank: number; index: number }, b: { rank: number; index: number }) => a.rank - b.rank || a.index - b.index;
  const kept = candidates.length <= max
    ? [...candidates]
    : [...candidates].sort(byRank).slice(0, max).sort((a, b) => a.index - b.index);
  if (order === "waiting") kept.sort(byRank);
  return {
    dots: kept.map(({ agent, state }) => ({ agentId: agent.id, title: agent.title ?? "New agent", state })),
    more: candidates.length - kept.length,
  };
}

/** Waiting on the user: a permission request, an unread result or an unread error. */
function wantsYou(agent: AgentInfo, state: DotState): boolean {
  return state === "permission" || state === "finished" || (state === "error" && agent.requiresAttention);
}

export interface ListEntry {
  agentId: string;
  workspaceId: string;
  title: string;
  state: DotState;
  at: string | null;
}

const LIST_ORDER: Record<DotState, number> = { permission: 0, error: 1, finished: 2, running: 3, read: 4 };

/**
 * Every tab across all workspaces that is waiting on the user, plus running ones unless `show` is
 * "unread"; read tabs are never listed. Most urgent state first, newest first within a state.
 */
export function unreadList(agents: ReadonlyMap<string, AgentInfo>, show: ShowMode): ListEntry[] {
  const entries: ListEntry[] = [];
  for (const tabs of rootsByWorkspace(agents).values()) {
    for (const agent of tabs) {
      const state = dotState(agent);
      if (!wantsYou(agent, state) && !(show !== "unread" && state === "running")) continue;
      entries.push({ agentId: agent.id, workspaceId: agent.workspaceId, title: agent.title ?? "New agent", state, at: agent.at });
    }
  }
  return entries.sort((a, b) => LIST_ORDER[a.state] - LIST_ORDER[b.state] || (b.at ?? "").localeCompare(a.at ?? ""));
}

/**
 * Everything `unreadList` can show, in any mode: tabs (root agents) with title, workspace, state
 * and attention, plus the time of every tab that isn't read (read tabs are never listed).
 * Equal keys mean an update changed nothing on the phone row, sheet or screen.
 */
export function unreadListKey(agents: ReadonlyMap<string, AgentInfo>): string {
  const parts: unknown[] = [];
  for (const tabs of rootsByWorkspace(agents).values()) {
    for (const agent of tabs) {
      const state = dotState(agent);
      parts.push([agent.id, agent.workspaceId, agent.title, state, agent.requiresAttention, state === "read" ? null : agent.at]);
    }
  }
  return JSON.stringify(parts);
}

/**
 * True when a CSS colour is light (so the theme is dark). Reads `#rgb`, `#rrggbb`, `#rrggbbaa`
 * and `rgb()/rgba()`; anything else counts as dark text.
 */
export function isLightText(color: string): boolean {
  const value = color.trim();
  let channels: number[] = [];
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)?.[1];
  if (hex && (hex.length === 3 || hex.length === 4)) channels = [...hex.slice(0, 3)].map((digit) => parseInt(digit + digit, 16));
  else if (hex && (hex.length === 6 || hex.length === 8)) channels = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
  else if (/^rgba?\(/i.test(value)) channels = (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
}
