import type { PastSession, Scope } from "../shared/rpc";
import type { OmpSession } from "./omp-sessions";
import { isSameOrInside } from "./slug";

export interface AgentRecord {
  id: string;
  title: string | null;
  /** Resolved (realpath) cwd. */
  cwd: string;
  provider: string;
  workspaceId: string | null;
  /** Paseo project id (`prj_…`). */
  projectId: string | null;
  archivedAt: string | null;
  updatedAt: string;
  lastUserMessageAt: string | null;
  /** Provider session ids and native handles (OMP: session id and/or .jsonl path). */
  sessionRefs: string[];
  /** The provider's transcript file when it can be located cheaply (OMP, Claude Code), else null. */
  transcript: string | null;
}

export interface ScopeFilter {
  mode: Scope;
  /** Workspaces whose agents always match: the current one, or every one in the project. */
  workspaceIds: string[];
  /** Resolved folders (folder and project modes); in project mode anything below them matches. */
  targets: string[];
  /** Project mode: agents Paseo placed in this project (by id) match wherever their cwd is. */
  projectId: string | null;
}

/**
 * Workspace mode trusts only the agent's workspace, so agents of sibling workspaces in the same
 * folder stay out. Folder and project modes also match by cwd, which catches agents whose
 * workspace was archived since.
 */
export function agentInScope(agent: AgentRecord, scope: ScopeFilter): boolean {
  if (agent.workspaceId && scope.workspaceIds.includes(agent.workspaceId)) return true;
  if (scope.mode === "workspace") return false;
  if (scope.mode === "folder") return scope.targets.includes(agent.cwd);
  if (scope.projectId && agent.projectId === scope.projectId) return true;
  return scope.targets.some((target) => isSameOrInside(target, agent.cwd));
}

const LONE_TAG = /^<\/?[\w-]+>$/;

/**
 * First meaningful prompt line, whole: wrapper lines such as `<chat-history-summary>` are
 * skipped, and the UI ellipsizes by width.
 */
export function titleFromPrompt(prompt: string | null): string | null {
  return (
    prompt
      ?.split("\n")
      .map((part) => part.trim())
      .find((part) => part.length > 0 && !LONE_TAG.test(part)) ?? null
  );
}

// Unicode private-use characters: Nerd Font glyphs OMP puts in session titles. App fonts have no
// glyph for them, so they would render as empty boxes.
const PRIVATE_USE = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;

/** A displayable title: icon-font glyphs removed, whitespace trimmed; null when nothing is left. */
export function cleanTitle(title: string | null | undefined): string | null {
  const cleaned = title?.replace(PRIVATE_USE, "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

/** Newest activity first; ties broken by key so the order is stable. */
export function byNewest(a: PastSession, b: PastSession): number {
  if (a.at === b.at) return a.key.localeCompare(b.key);
  return a.at < b.at ? 1 : -1;
}

export interface MergedPastSessions {
  /** The main list. Workspace mode: archived agents only; other modes: both sources. */
  entries: PastSession[];
  /** Workspace mode only: the folder's OMP sessions Paseo never opened. */
  sameFolder: PastSession[];
  /** OMP sessions skipped because a Paseo agent (live or archived, anywhere) owns them. */
  hiddenKnownToPaseo: number;
}

/**
 * Archived Paseo agents in scope, plus OMP sessions (already filtered to the scope's folders)
 * that no Paseo agent owns. An OMP session is owned when an agent's session refs contain its
 * id or its file path.
 */
export function mergePastSessions(input: {
  agents: AgentRecord[];
  ompSessions: OmpSession[];
  scope: ScopeFilter;
}): MergedPastSessions {
  const known = new Set(input.agents.flatMap((agent) => agent.sessionRefs));
  const ompByRef = new Map<string, OmpSession>();
  for (const session of input.ompSessions) {
    ompByRef.set(session.sessionId, session);
    ompByRef.set(session.file, session);
  }

  const archived: PastSession[] = [];
  for (const agent of input.agents) {
    if (!agent.archivedAt || !agentInScope(agent, input.scope)) continue;
    const session = agent.sessionRefs.map((ref) => ompByRef.get(ref)).find(Boolean);
    archived.push({
      key: `paseo:${agent.id}`,
      source: "paseo",
      title:
        cleanTitle(agent.title) ||
        cleanTitle(session?.title) ||
        cleanTitle(titleFromPrompt(session?.firstPrompt ?? null)) ||
        "Untitled agent",
      cwd: agent.cwd,
      at: session?.mtime ?? agent.lastUserMessageAt ?? agent.updatedAt,
      provider: agent.provider,
      agentId: agent.id,
      ...(agent.transcript ? { file: agent.transcript } : {}),
      preview: null,
    });
  }

  let hiddenKnownToPaseo = 0;
  const newestOmp = new Map<string, OmpSession>();
  for (const session of input.ompSessions) {
    if (known.has(session.sessionId) || known.has(session.file)) {
      hiddenKnownToPaseo += 1;
      continue;
    }
    const previous = newestOmp.get(session.sessionId);
    if (!previous || previous.mtime < session.mtime) newestOmp.set(session.sessionId, session);
  }
  const terminal: PastSession[] = [...newestOmp.values()].map((session) => ({
    key: `omp:${session.sessionId}`,
    source: "omp",
    title: cleanTitle(session.title) || cleanTitle(titleFromPrompt(session.firstPrompt)) || "Empty session",
    cwd: session.cwd,
    at: session.mtime,
    provider: session.provider,
    sessionId: session.sessionId,
    file: session.file,
    preview: null,
  }));

  if (input.scope.mode === "workspace") {
    return {
      entries: archived.sort(byNewest),
      sameFolder: terminal.sort(byNewest),
      hiddenKnownToPaseo,
    };
  }
  return { entries: [...archived, ...terminal].sort(byNewest), sameFolder: [], hiddenKnownToPaseo };
}
