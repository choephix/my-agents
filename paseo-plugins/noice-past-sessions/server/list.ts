import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { listPastSessions, PastSession, Scope } from "../shared/rpc";
import { byNewest, mergePastSessions, type AgentRecord } from "./merge";
import { OmpSessionIndex, resolvedOrSelf, type OmpSessionRoot } from "./omp-sessions";
import { memoKeys, memoReader, type Memo } from "./memos";
import { TailCache } from "./preview";

type Paseo = PluginHandlerContext["paseo"];

/**
 * Session folders for every enabled OMP-based Paseo provider: the built-in `omp` provider
 * reads `~/.omp/agent/sessions`; a provider that extends `omp` with `OMP_PROFILE=<name>`
 * reads `~/.omp/profiles/<name>/agent/sessions`. The first provider per folder imports it.
 */
export function sessionRootsFromProviders(providers: Record<string, unknown>, home: string): OmpSessionRoot[] {
  const roots: OmpSessionRoot[] = [];
  const seen = new Set<string>();
  const ids = ["omp", ...Object.keys(providers).filter((id) => id !== "omp").sort()];
  for (const id of ids) {
    const raw = providers[id];
    const entry = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    if (id !== "omp" && entry.extends !== "omp") continue;
    if (entry.enabled === false) continue;
    const env = entry.env && typeof entry.env === "object" ? (entry.env as Record<string, unknown>) : {};
    const profile = typeof env.OMP_PROFILE === "string" ? env.OMP_PROFILE.trim() : "";
    const dir =
      profile && profile !== "default"
        ? path.join(home, ".omp", "profiles", profile, "agent", "sessions")
        : path.join(home, ".omp", "agent", "sessions");
    if (seen.has(dir)) continue;
    seen.add(dir);
    roots.push({ dir, provider: id });
  }
  return roots;
}

let index: Promise<OmpSessionIndex> | null = null;
async function sessionIndex(): Promise<OmpSessionIndex> {
  index ??= Promise.all([resolvedOrSelf(homedir()), resolvedOrSelf(tmpdir())]).then(
    ([home, tmp]) => new OmpSessionIndex({ home, tmp }),
  );
  return index;
}
const tails = new TailCache();

/**
 * The agent's transcript, when finding it costs at most a stat: OMP stores the session file as
 * its native handle; Claude Code keeps `~/.claude/projects/<cwd, non-alphanumerics → "-">/<id>.jsonl`.
 * Codex rollouts sit in date folders that would need a search, so they get no preview.
 */
export function transcriptFile(
  persistence: { provider: string; sessionId: string; nativeHandle?: string } | null | undefined,
  cwd: string,
  home: string,
): string | null {
  if (!persistence) return null;
  const handle = persistence.nativeHandle;
  if (handle && path.isAbsolute(handle) && handle.endsWith(".jsonl")) return handle;
  if (persistence.provider === "claude" && persistence.sessionId) {
    return path.join(home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${persistence.sessionId}.jsonl`);
  }
  return null;
}

/**
 * Adds previews (a memo left on the session, else the transcript's last reply) and dates rows by
 * their transcript's newest record, then re-sorts. 24 files are read at a time. A damaged
 * `memos.json` only drops the memos; the list still loads.
 */
export async function withPreviews(entries: PastSession[]): Promise<PastSession[]> {
  const memos = await memoReader.load().catch((error: unknown) => {
    console.warn(`noice-past-sessions: ignoring memos.json: ${error instanceof Error ? error.message : String(error)}`);
    return new Map<string, Memo>();
  });
  const out: PastSession[] = [];
  for (let start = 0; start < entries.length; start += 24) {
    out.push(
      ...(await Promise.all(
        entries.slice(start, start + 24).map(async (entry): Promise<PastSession> => {
          const tail = entry.file ? await tails.summary(entry.file) : null;
          const memo = memoKeys(entry).map((key) => memos.get(key)).find((found) => found !== undefined);
          const preview: PastSession["preview"] = memo
            ? { text: memo.memo, kind: "memo", ...(memo.attention ? { attention: memo.attention } : {}) }
            : tail?.reply
              ? { text: tail.reply, kind: "reply" }
              : null;
          return { ...entry, at: tail?.lastActiveAt ?? entry.at, preview };
        }),
      )),
    );
  }
  return out.sort(byNewest);
}

export async function listAllWorkspaces(paseo: Paseo) {
  const all = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    all.push(...page.entries);
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return all;
}

/** The workspace's folder, as the listing shows it; null when the workspace is gone. */
export async function workspaceFolder(paseo: Paseo, workspaceId: string): Promise<string | null> {
  const workspace = (await listAllWorkspaces(paseo)).find((candidate) => candidate.id === workspaceId);
  return workspace ? (workspace.workspaceDirectory ?? workspace.projectRootPath) : null;
}

export async function listAllAgents(paseo: Paseo) {
  const all = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({
      filter: { includeArchived: true },
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    all.push(...page.entries);
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return all;
}

/** Every checkout of a git repo (Paseo, herdr and hand-made worktrees); [] when not a repo. */
async function gitWorktrees(repo: string, warnings: string[]): Promise<string[]> {
  try {
    const { stdout } = await promisify(execFile)("git", ["-C", repo, "worktree", "list", "--porcelain"], {
      timeout: 5_000,
    });
    return stdout
      .split("\n")
      .filter((row) => row.startsWith("worktree "))
      .map((row) => row.slice("worktree ".length));
  } catch (error) {
    warnings.push(`git worktree list failed for ${repo}: ${String(error)}`);
    return [];
  }
}

/** Everything both list handlers need about a workspace's scope; built from daemon API calls. */
export interface ScopeContext {
  workspace: { id: string; name: string; projectRootPath: string; projectDisplayName: string };
  folder: string;
  /** Resolved folders the scope covers; with `includeSubfolders` anything below them too. */
  targets: string[];
  includeSubfolders: boolean;
  projectWorkspaceIds: string[];
  projectId: string;
  agents: AgentRecord[];
  providers: Record<string, unknown>;
  home: string;
  warnings: string[];
}

export async function scopeContext(paseo: Paseo, workspaceId: string, scope: Scope): Promise<ScopeContext> {
  const warnings: string[] = [];
  const [workspaces, agentEntries, config] = await Promise.all([
    listAllWorkspaces(paseo),
    listAllAgents(paseo),
    paseo.config.get().catch((error: unknown) => {
      warnings.push(`Daemon config unavailable, using ~/.omp/agent/sessions only: ${String(error)}`);
      return null;
    }),
  ]);
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
  const folder = workspace.workspaceDirectory ?? workspace.projectRootPath;
  const projectWorkspaces = workspaces.filter((candidate) => candidate.projectId === workspace.projectId);
  const includeSubfolders = scope === "project";
  const rawTargets = includeSubfolders
    ? [
        workspace.projectRootPath,
        ...projectWorkspaces.map((candidate) => candidate.workspaceDirectory ?? ""),
        ...(workspace.projectKind === "git" ? await gitWorktrees(workspace.projectRootPath, warnings) : []),
      ]
    : [folder];
  const home = homedir();
  const agents: AgentRecord[] = await Promise.all(
    agentEntries.map(async ({ agent, project }) => ({
      id: agent.id,
      title: agent.title,
      cwd: await resolvedOrSelf(agent.cwd),
      provider: agent.provider,
      workspaceId: agent.workspaceId ?? null,
      // The agent listing's `project.projectKey` is the project id (`prj_…`), not the
      // `host:…` / `remote:…` key that `projects.list()` calls projectKey.
      projectId: project?.projectKey ?? null,
      archivedAt: agent.archivedAt ?? null,
      updatedAt: agent.updatedAt,
      lastUserMessageAt: agent.lastUserMessageAt,
      sessionRefs: [
        agent.persistence?.sessionId,
        agent.persistence?.nativeHandle,
        agent.runtimeInfo?.sessionId,
      ].filter((ref): ref is string => typeof ref === "string" && ref.length > 0),
      transcript: agent.archivedAt ? transcriptFile(agent.persistence, agent.cwd, home) : null,
    })),
  );
  return {
    workspace,
    folder,
    targets: [...new Set(await Promise.all(rawTargets.filter(Boolean).map(resolvedOrSelf)))],
    includeSubfolders,
    projectWorkspaceIds: projectWorkspaces.map((candidate) => candidate.id),
    projectId: workspace.projectId,
    agents,
    providers: config?.config.providers ?? {},
    home,
    warnings,
  };
}

export async function listHandler(
  input: RpcInput<typeof listPastSessions>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof listPastSessions>> {
  const started = performance.now();
  const context = await scopeContext(paseo, input.workspaceId, input.scope);
  const { workspace, targets, includeSubfolders, home } = context;
  const { sessions, stats } = await (await sessionIndex()).list({
    sessionRoots: sessionRootsFromProviders(context.providers, home),
    targets,
    includeSubfolders,
  });

  const { entries, sameFolder, hiddenKnownToPaseo } = mergePastSessions({
    agents: context.agents,
    ompSessions: sessions,
    scope: {
      mode: input.scope,
      targets,
      workspaceIds: includeSubfolders ? context.projectWorkspaceIds : [workspace.id],
      projectId: includeSubfolders ? context.projectId : null,
    },
  });

  return {
    workspaceName: workspace.name,
    home,
    folder: context.folder,
    projectRoot: workspace.projectRootPath,
    projectName: workspace.projectDisplayName,
    scope: input.scope,
    entries: await withPreviews(entries),
    sameFolder: await withPreviews(sameFolder),
    stats: {
      elapsedMs: Math.round(performance.now() - started),
      ompDirsScanned: stats.dirsScanned,
      ompFilesSeen: stats.filesSeen,
      ompFilesRead: stats.filesRead,
      hiddenKnownToPaseo,
    },
    warnings: context.warnings,
  };
}
