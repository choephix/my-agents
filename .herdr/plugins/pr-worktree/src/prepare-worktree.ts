import { $ } from "bun";
import { statSync } from "node:fs";

export interface SourceContext {
  paneId?: string;
  cwd?: string;
  workspaceId?: string;
}

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: string;
  isCrossRepository: boolean;
}

export interface WorktreeMatch {
  path: string;
  branch: string;
  dirty: boolean;
  openWorkspaceId?: string;
}

export interface ReadyWorktree {
  action: "focused" | "opened" | "created";
  workspaceId?: string;
  path: string;
  branch: string;
  pr: PrRef;
}

export class PrepareError extends Error {
  override name = "PrepareError";
}

export interface PrepareOptions {
  input: string;
  source: SourceContext;
  confirmReplace: (matches: WorktreeMatch[]) => Promise<boolean>;
  onStep?: OnStep;
}

type OnStep = (message: string) => void;

interface HerdrWorkspace {
  workspace_id: string;
  label: string;
  focused?: boolean;
}

interface HerdrWorktree {
  path: string;
  branch?: string;
  is_linked_worktree?: boolean;
  is_bare?: boolean;
  is_prunable?: boolean;
  open_workspace_id?: string | null;
}

interface ParentRepository {
  repoRoot: string;
  worktrees: HerdrWorktree[];
}

function firstLine(value: unknown, fallback: string): string {
  const line = String(value ?? "").split(/\r?\n/, 1)[0].trim();
  return line || fallback;
}

type HerdrResponse<T> = { result?: T; error?: { message?: unknown } };

function herdrPayload<T>(output: $.ShellOutput): HerdrResponse<T> | undefined {
  try {
    return JSON.parse(output.stdout.toString());
  } catch {
    return undefined;
  }
}

function herdrResult<T>(output: $.ShellOutput, fallback: string): T {
  const response = herdrPayload<T>(output);
  if (!response) {
    throw new PrepareError(firstLine(output.stderr.toString(), fallback));
  }
  if (response.error) {
    throw new PrepareError(firstLine(response.error.message, fallback));
  }
  if (!("result" in response)) throw new PrepareError(fallback);
  return response.result as T;
}

const PR_URL =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;

function parsePrUrl(value: string): { owner: string; repo: string; number: number } | undefined {
  const match = PR_URL.exec(value);
  return match
    ? { owner: match[1], repo: match[2], number: Number(match[3]) }
    : undefined;
}

async function resolvePr(opts: PrepareOptions): Promise<PrRef> {
  const input = opts.input.trim();
  const numberInput = /^#?\d+$/.test(input);
  const urlInput = parsePrUrl(input);
  if (!numberInput && !urlInput) {
    throw new PrepareError("expected a PR number or GitHub PR URL");
  }

  let ref: string;
  let cwd: string | undefined;
  if (numberInput) {
    cwd = opts.source.cwd;
    if (!cwd) {
      throw new PrepareError("give a full PR URL (no source directory to resolve #N against)");
    }
    let isDirectory = false;
    try {
      isDirectory = statSync(cwd).isDirectory();
    } catch {}
    if (!isDirectory) throw new PrepareError(`source directory is unavailable: ${cwd}`);
    ref = input.replace(/^#/, "");
  } else {
    // gh only treats the ref as a URL when it carries an explicit scheme.
    ref = `https://github.com/${urlInput!.owner}/${urlInput!.repo}/pull/${urlInput!.number}`;
  }

  opts.onStep?.("Resolving PR…");
  const command = $`gh pr view ${ref} --json number,title,url,state,headRefName,isCrossRepository`
    .quiet()
    .nothrow();
  if (cwd) command.cwd(cwd);
  const output = await command;
  if (output.exitCode !== 0) {
    throw new PrepareError(firstLine(output.stderr.toString(), "could not resolve PR"));
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(output.stdout.toString());
  } catch {
    throw new PrepareError("gh returned invalid PR details");
  }

  const url = typeof raw.url === "string" ? raw.url : "";
  const canonical = parsePrUrl(url);
  if (
    !canonical ||
    typeof raw.number !== "number" ||
    typeof raw.title !== "string" ||
    typeof raw.headRefName !== "string" ||
    typeof raw.state !== "string" ||
    typeof raw.isCrossRepository !== "boolean"
  ) {
    throw new PrepareError("gh returned invalid PR details");
  }

  const pr: PrRef = {
    owner: canonical.owner,
    repo: canonical.repo,
    number: raw.number,
    title: raw.title,
    url,
    headRefName: raw.headRefName,
    state: raw.state,
    isCrossRepository: raw.isCrossRepository,
  };
  if (pr.state !== "OPEN") {
    opts.onStep?.(`PR is ${pr.state} — continuing`);
  }
  return pr;
}

function normalizeGithubRemote(remote: string): string | undefined {
  const scp = remote.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  let path: string;
  if (scp) {
    path = `${scp[1]}/${scp[2]}`;
  } else {
    try {
      const url = new URL(remote);
      if (url.hostname.toLowerCase() !== "github.com") return undefined;
      path = url.pathname.replace(/^\/+/, "");
    } catch {
      return undefined;
    }
  }

  const parts = path.replace(/\/+$/, "").split("/");
  if (parts.length !== 2) return undefined;
  const repo = parts[1].replace(/\.git$/i, "");
  if (!parts[0] || !repo) return undefined;
  return `${parts[0]}/${repo}`.toLowerCase();
}

async function repoMatches(repoRoot: string, target: string): Promise<boolean> {
  const remotes = await $`git -C ${repoRoot} remote -v`.quiet().nothrow();
  if (remotes.exitCode !== 0) return false;
  return remotes.stdout
    .toString()
    .split(/\r?\n/)
    .some((line) => {
      const fields = line.trim().split(/\s+/);
      return fields.length >= 2 && normalizeGithubRemote(fields[1]) === target;
    });
}

async function findParent(pr: PrRef, onStep?: OnStep): Promise<ParentRepository> {
  onStep?.("Finding parent repository…");
  const listed = herdrResult<{ workspaces?: HerdrWorkspace[] }>(
    await $`herdr workspace list`.quiet().nothrow(),
    "could not list Herdr workspaces",
  );
  if (!Array.isArray(listed.workspaces)) {
    throw new PrepareError("Herdr returned an invalid workspace list");
  }

  const candidates = [
    ...listed.workspaces.filter((workspace) => workspace.focused),
    ...listed.workspaces.filter((workspace) => !workspace.focused),
  ];
  const inspected = new Set<string>();
  const target = `${pr.owner}/${pr.repo}`.toLowerCase();

  for (const workspace of candidates) {
    const output = await $`herdr worktree list --workspace ${workspace.workspace_id}`.quiet().nothrow();
    const result = herdrPayload<{
      source?: { repo_root: string; repo_name: string };
      worktrees?: HerdrWorktree[];
    }>(output)?.result;
    if (!result?.source?.repo_root || inspected.has(result.source.repo_root)) continue;
    inspected.add(result.source.repo_root);

    if (!(await repoMatches(result.source.repo_root, target))) continue;
    if (!Array.isArray(result.worktrees)) {
      throw new PrepareError("Herdr returned an invalid worktree list");
    }

    onStep?.(`Parent: ${result.source.repo_name} via workspace ${workspace.label}`);
    return { repoRoot: result.source.repo_root, worktrees: result.worktrees };
  }

  throw new PrepareError(`no open Herdr workspace for ${pr.owner}/${pr.repo}`);
}

function branchName(pr: PrRef): string {
  const slug = pr.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, ""); // the 32-char cut can land on a separator
  return slug ? `pr/${pr.number}-${slug}` : `pr/${pr.number}`;
}

async function matchingWorktrees(
  worktrees: HerdrWorktree[],
  pr: PrRef,
  onStep?: OnStep,
): Promise<WorktreeMatch[]> {
  onStep?.("Checking existing worktrees…");
  const prefix = `pr/${pr.number}`;
  const matches: WorktreeMatch[] = [];
  for (const worktree of worktrees) {
    const branch = worktree.branch;
    if (!branch || worktree.is_linked_worktree !== true || worktree.is_bare || worktree.is_prunable) {
      continue;
    }
    // For a cross-fork PR, headRefName names a branch inside the fork, so a
    // same-named local branch is unrelated — only deterministic names count.
    const sameHead = !pr.isCrossRepository && branch === pr.headRefName;
    if (branch !== prefix && !branch.startsWith(`${prefix}-`) && !sameHead) continue;

    const status = await $`git -C ${worktree.path} status --porcelain`.quiet().nothrow();
    if (status.exitCode !== 0) {
      throw new PrepareError(firstLine(status.stderr.toString(), `could not inspect ${worktree.path}`));
    }
    matches.push({
      path: worktree.path,
      branch,
      dirty: status.stdout.toString().trim().length > 0,
      openWorkspaceId: worktree.open_workspace_id ?? undefined,
    });
  }
  return matches;
}

async function removeMatches(
  matches: WorktreeMatch[],
  repoRoot: string,
  onStep?: OnStep,
): Promise<void> {
  for (const match of matches) {
    onStep?.(`Removing worktree ${match.path}…`);
    if (match.openWorkspaceId) {
      herdrResult(
        await $`herdr worktree remove --workspace ${match.openWorkspaceId}`.quiet().nothrow(),
        `could not remove ${match.path}`,
      );
      continue;
    }

    const removed = await $`git -C ${repoRoot} worktree remove ${match.path}`.quiet().nothrow();
    if (removed.exitCode !== 0) {
      throw new PrepareError(firstLine(removed.stderr.toString(), `could not remove ${match.path}`));
    }
  }
}

async function reuseWorktree(
  match: WorktreeMatch,
  repoRoot: string,
  pr: PrRef,
  onStep?: OnStep,
): Promise<ReadyWorktree> {
  onStep?.(`Reusing worktree ${match.path}…`);
  if (match.openWorkspaceId) {
    herdrResult(
      await $`herdr workspace focus ${match.openWorkspaceId}`.quiet().nothrow(),
      `could not focus workspace ${match.openWorkspaceId}`,
    );
    return {
      action: "focused",
      workspaceId: match.openWorkspaceId,
      path: match.path,
      branch: match.branch,
      pr,
    };
  }

  const opened = herdrResult<{ workspace?: { workspace_id?: string } }>(
    await $`herdr worktree open --cwd ${repoRoot} --path ${match.path} --focus`.quiet().nothrow(),
    `could not open ${match.path}`,
  );
  if (!opened.workspace?.workspace_id) {
    throw new PrepareError("Herdr returned an invalid opened workspace");
  }
  return {
    action: "opened",
    workspaceId: opened.workspace.workspace_id,
    path: match.path,
    branch: match.branch,
    pr,
  };
}

async function createWorktree(
  branch: string,
  repoRoot: string,
  pr: PrRef,
  onStep?: OnStep,
): Promise<ReadyWorktree> {
  // Fetch before the worktree exists. Herdr's worktree.created hook starts repo
  // setup (installs, builds) as soon as the checkout appears, so the PR's code
  // must already be on the branch; checking out afterwards would let setup run
  // against the wrong tree. refs/pull/N/head also covers fork PRs without
  // adding a remote, which is why this replaces `gh pr checkout`.
  onStep?.("Fetching PR…");
  const refspecs = [`+refs/pull/${pr.number}/head:refs/heads/${branch}`];
  // Same-repo PRs also get their real branch, so the worktree can track it.
  if (!pr.isCrossRepository) {
    refspecs.push(`+refs/heads/${pr.headRefName}:refs/remotes/origin/${pr.headRefName}`);
  }
  const fetched = await $`git -C ${repoRoot} fetch origin ${refspecs}`.quiet().nothrow();
  if (fetched.exitCode !== 0) {
    throw new PrepareError(firstLine(fetched.stderr.toString(), "could not fetch PR"));
  }

  onStep?.("Creating worktree…");
  const created = herdrResult<{
    worktree?: { path?: string };
    workspace?: { workspace_id?: string };
  }>(
    await $`herdr worktree create --cwd ${repoRoot} --branch ${branch} --focus`.quiet().nothrow(),
    "could not create worktree",
  );
  const path = created.worktree?.path;
  const workspaceId = created.workspace?.workspace_id;
  if (!path || !workspaceId) {
    throw new PrepareError("Herdr returned an invalid created worktree");
  }

  if (!pr.isCrossRepository) {
    // A fork's head has no local remote-tracking ref, so only same-repo PRs can
    // have an upstream. Non-fatal: the worktree is already usable without one.
    await $`git -C ${path} branch --set-upstream-to=origin/${pr.headRefName} ${branch}`
      .quiet()
      .nothrow();
  }

  return { action: "created", workspaceId, path, branch, pr };
}

export async function preparePrWorktree(opts: PrepareOptions): Promise<ReadyWorktree> {
  const pr = await resolvePr(opts);
  const parent = await findParent(pr, opts.onStep);
  const branch = branchName(pr);

  const matches = await matchingWorktrees(parent.worktrees, pr, opts.onStep);
  if (matches.length === 0) return createWorktree(branch, parent.repoRoot, pr, opts.onStep);

  if (await opts.confirmReplace(matches)) {
    await removeMatches(matches, parent.repoRoot, opts.onStep);
    return createWorktree(branch, parent.repoRoot, pr, opts.onStep);
  }

  return reuseWorktree(
    matches.find((match) => match.branch === branch) ?? matches[0],
    parent.repoRoot,
    pr,
    opts.onStep,
  );
}
