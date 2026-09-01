---
name: nilo-worktree-setup
description: Use when Stefan asks for a new NILO worktree, starts a new NILO feature, or wants an existing NILO branch checked out in an isolated worktree. Uses the workspace helper script with Stefan's branch naming and origin/main freshness conventions.
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [nilo, worktree, git, workflow]
    related_skills: [github-operations]
---

# NILO Worktree Setup

## Overview

Use the NILO worktree helper whenever Stefan asks for a new NILO worktree or says he is starting work on a new NILO feature. Do **not** manually copy the repo or hand-roll worktree setup unless the helper script is unavailable or fails and Stefan approves an alternative.

The helper script lives at:

```bash
/home/cx/workspace/create-nilo-worktree.sh
```

It creates the worktree as a Herdr workspace, so it lands under:

```bash
/home/cx/.herdr/worktrees/nilo/<sanitized-branch>/
```

Older worktrees still live in `/home/cx/workspace/nilo-worktrees/`; that path is legacy and should not be used for new work.

It also creates a per-worktree `.env` with a unique `PORT`, links `.env.local` and `.agents-local` to the main checkout, runs `.agents-local/hijack.sh`, `pnpm install`, and `pnpm build:non-client`.

## When to Use

Use this skill when Stefan says things like:

- "I'm starting a new NILO feature; make me a worktree."
- "Create a NILO worktree for X."
- "Check out existing branch X in a NILO worktree."
- "I need a separate NILO workspace for this bug/feature."
- "Create a PR for X."
- "Create a draft PR for X."
- "Create a potential PR for X."

Do not use this skill for non-NILO projects or for temporary throwaway experiments outside the NILO repo.

## Glossary

When Stefan uses these phrases in a NILO context, interpret them as workflow requests, not just wording variants:

- **Create a new worktree** / **make me a worktree**: create the git worktree using this skill and stop after verified setup unless he also asks for implementation work.
- **Create a PR**: create the git worktree, launch a coding agent to implement the requested changes, independently verify the result, commit, push the branch, and open a normal non-draft PR.
- **Create a draft PR**: create the git worktree, launch a coding agent to implement the requested changes, independently verify the result, commit, push the branch, and open a draft PR.
- **Create a potential PR**: create the git worktree, launch a coding agent to implement the requested changes, independently verify the result, and commit locally. Also draft a PR title and description, but do **not** push and do **not** create a GitHub PR.

Default coding agent for these PR workflows is Oh My Pi via the `omp` CLI unless Stefan asks for another agent.

Brief `omp` usage hints: `omp` is the Oh My Pi terminal coding agent (`@oh-my-pi/pi-coding-agent`). Run it from the target worktree so project discovery and edits are scoped to the new branch. For a new task, launch with a clear initial prompt, e.g. `omp "<goal, constraints, acceptance criteria, validation commands>"`; use `omp -p "..."` only when a non-interactive stdout result is specifically useful. If Stefan names a model informally, map it with `omp models`, `omp models find <pattern>`, or `omp models --json`, then pass the resolved model with `--model <provider/model-or-alias>`; otherwise omit `--model` and let `omp` use its configured default. Useful model-role flags are `--smol <model>` for lightweight/fast subtasks, `--slow <model>` for thorough reasoning, and `--plan <model>` for planning. Avoid documenting/session-resume commands such as `omp --continue` in this workflow: PR tasks should start from the fresh worktree context.

For any coding-agent workflow, follow the autonomous coding agent discipline: package a clear prompt, run the agent in the new worktree, inspect the diff yourself, run relevant tests/checks, and do not trust the agent's self-report without verification.

## Branch Naming Rules

### New feature branches

Unless Stefan specifies a branch name or says it is a hotfix, create new NILO feature branches with Stefan's prefix:

```text
stefan/<short-kebab-description>
```

Examples:

```text
stefan/calendar-sync
stefan/improve-onboarding-copy
stefan/fix-invoice-export-state
```

Prefer short, descriptive, lowercase kebab-case after `stefan/`.

### Existing branches

If Stefan gives an existing branch name, use it **exactly**. Do not rename it and do not add `stefan/`.

Example request:

> Make me a worktree for existing branch `feature/calendar-sync`.

Use:

```bash
/home/cx/workspace/create-nilo-worktree.sh feature/calendar-sync
```

### Hotfixes

If Stefan says the work is a hotfix, do not force the `stefan/` prefix. Use the branch naming he provides, or choose an appropriate hotfix name only if he leaves it to you.

## Fresh Base Rule for New Branches

New branches should be based on the latest remote `origin/main`, not stale local `main` and not whatever branch happens to be checked out in `/home/cx/workspace/nilo`.

The helper script now enforces this by default: when creating a new branch and `BASE_REF` is unset, it fetches `origin/main` and creates the branch from `origin/main`.

Default new-branch pattern:

```bash
cd /home/cx/workspace
./create-nilo-worktree.sh stefan/<short-kebab-description>
```

For stacked PRs or other branch-off-branch work, set `BASE_REF` explicitly. `BASE_REF` may be:

- a local branch/ref, e.g. `BASE_REF=stefan/previous-pr`
- an explicit remote branch, e.g. `BASE_REF=origin/stefan/previous-pr`
- a branch name that exists on origin, e.g. `BASE_REF=stefan/previous-pr` when no local branch by that name exists

Stacked branch pattern:

```bash
cd /home/cx/workspace
BASE_REF=<base-branch-or-ref> ./create-nilo-worktree.sh stefan/<short-kebab-description>
```

For existing local or remote branches, just pass the branch name. The script reuses local branches or creates local tracking branches from `origin/<branch>` when available.

## Standard Workflow

### Worktree-only requests

1. Decide whether the request is for a new branch or an existing branch.
2. Choose/confirm the branch name:
   - New feature: `stefan/<short-kebab-description>` unless specified otherwise.
   - Existing branch: exact name Stefan gave.
   - Hotfix: follow Stefan's requested naming or use a clear hotfix name.
3. For new branches, rely on the helper's default fresh `origin/main` base unless Stefan asks to branch from a different base.
4. For stacked PRs or explicit alternate bases, set `BASE_REF=<base-branch-or-ref>`.
5. Run the helper from `/home/cx/workspace`.
6. Verify the created worktree.
7. Report the resulting path, branch, base, port, and install result.

### PR / draft PR / potential PR requests

1. Create and verify the NILO worktree using the worktree-only workflow.
2. Launch the coding agent from inside the new worktree. Default to `omp` unless Stefan specifies another coding agent.
3. Instruct the coding agent with the feature/bug goal, constraints, acceptance criteria, and expected validation commands.
4. Wait for the agent to finish; inspect its output and the resulting git diff yourself.
5. Run relevant tests/lints/builds or clearly report any blocker preventing verification.
6. Commit the verified changes locally.
7. Finish according to Stefan's wording:
   - "create a PR": push and create a normal non-draft PR.
   - "create a draft PR": push and create a draft PR.
   - "create a potential PR": do not push; do not create a PR; provide the local commit plus a proposed PR title and description.

## Commands

### Check default coding agent availability

```bash
command -v omp
```

If `omp` is unavailable, do not silently switch agents. For substantial implementation work, report the blocker or ask Stefan whether to use another available coding agent. For a trivially scoped mechanical change (for example, a known literal replacement in one/few files), direct Hermes edits are acceptable if they are lower-risk than agent handoff, the diff is independently inspected, targeted validation runs, and the final report explicitly notes that `omp` was unavailable and direct edits were used.

### Ensure pnpm is available for the helper

The worktree helper runs `pnpm install`. If `pnpm` is not installed/on `PATH` but Node/npm are available and `package.json` declares a `packageManager`, prefer a temporary shim rather than globally changing the machine:

```bash
tmpbin=$(mktemp -d)
printf '#!/usr/bin/env bash\nexec npx -y pnpm@10.14.0 "$@"\n' > "$tmpbin/pnpm"
chmod +x "$tmpbin/pnpm"
PATH="$tmpbin:$PATH" ./create-nilo-worktree.sh stefan/<short-kebab-description>
```

Use the pnpm version declared in `package.json` (currently `packageManager`) instead of hard-coding. This keeps the helper happy without a global install; still report any install warnings that may affect the worktree.

### New feature branch

```bash
cd /home/cx/workspace
./create-nilo-worktree.sh stefan/<short-kebab-description>
```

### New stacked branch from another base

```bash
cd /home/cx/workspace
BASE_REF=<base-branch-or-ref> ./create-nilo-worktree.sh stefan/<short-kebab-description>
```

Examples:

```bash
BASE_REF=stefan/previous-pr ./create-nilo-worktree.sh stefan/next-pr
BASE_REF=origin/stefan/previous-pr ./create-nilo-worktree.sh stefan/next-pr
```

### Existing branch

```bash
cd /home/cx/workspace
./create-nilo-worktree.sh <existing-branch-name>
```

### Optional explicit worktree folder name

Use only when Stefan asks for a specific folder name or the default sanitized branch name would be unclear:

```bash
cd /home/cx/workspace
BASE_REF=<base-branch-or-ref> ./create-nilo-worktree.sh stefan/<branch-name> <folder-name>
```

The script itself rejects unsafe folder names.

## What the Helper Script Does

The script:

1. Validates args and branch/folder names.
2. Assumes the source NILO repo is `/home/cx/workspace/nilo`.
3. Resolves the base ref, then creates the worktree through `herdr worktree create`, so it lands under `/home/cx/.herdr/worktrees/nilo/<sanitized-branch>` as its own Herdr workspace:
   - existing local branch: reuse it;
   - existing `origin/<branch>`: create a local tracking branch;
   - otherwise: create a new branch from `BASE_REF` if set, or from freshly fetched `origin/main` by default.
4. Delegates all post-create setup to `setup-existing-nilo-worktree.sh`, which writes `.env` with the next free `PORT` (from `31730`), links `.env.local` and `.agents-local` to the main checkout, copies the Vercel identity files, runs `.agents-local/hijack.sh`, `pnpm install`, and `pnpm build:non-client`.

## Setup Happens Automatically

Post-create setup is no longer the helper's job alone. The `stefan.worktree-setup` Herdr plugin fires on `worktree.created`, so a NILO worktree is set up the same way whether it came from the helper, a bare `herdr worktree create`, or `prefix+shift+g` in the TUI. The hook lives at `~/.config/herdr/plugins/config/stefan.worktree-setup/hooks/nilo.sh` (outside the repo, since NILO is a team repo) and its log is written to `~/.local/state/herdr/plugins/stefan.worktree-setup/logs/nilo-<branch>.log`.

Consequences when following this skill:

- `setup-existing-nilo-worktree.sh` locks per worktree and stamps completion, so the helper's own call blocks until the plugin's run finishes and then prints `Already set up; nothing to do.` **That message means success, not failure.**
- Setup for a TUI-created worktree runs in the background; wait for the `worktree ready · <branch>` notification, or tail the log above, before assuming `node_modules` exists.
- To genuinely redo setup, use the `Re-run worktree setup` plugin action, or `NILO_SETUP_FORCE=1 ./setup-existing-nilo-worktree.sh <worktree-dir>`.

## Verification Checklist

After running the helper, verify with real tool output before telling Stefan it is ready:

```bash
cd /home/cx/.herdr/worktrees/nilo/<sanitized-branch>
git branch --show-current
printf 'PORT=' && grep '^PORT=' .env
readlink .agents-local
git status --short
```

Check that:

- [ ] The worktree directory exists.
- [ ] The current branch is the intended branch.
- [ ] For a normal new branch, it was created from fresh `origin/main` by the helper default.
- [ ] For stacked PR work, the reported base matches the requested `BASE_REF`.
- [ ] `.env` exists and contains a `PORT=` value.
- [ ] `.agents-local` is a symlink to `/home/cx/workspace/nilo/.agents-local`.
- [ ] `pnpm install` completed successfully in the helper output.
- [ ] `git status --short` does not show surprising changes other than expected generated/local setup files.

For PR / draft PR / potential PR requests, additionally check:

- [ ] `omp` was used unless Stefan specified another coding agent, or unavailability/fallback was explicitly handled.
- [ ] The coding agent ran in the intended worktree, not in `/home/cx/workspace/nilo` or another worktree.
- [ ] The resulting diff was inspected independently.
- [ ] Relevant tests/lints/builds were run, or blockers were reported honestly.
- [ ] Changes were committed locally.
- [ ] Normal PR: branch was pushed and a non-draft PR was created.
- [ ] Draft PR: branch was pushed and a draft PR was created.
- [ ] Potential PR: branch was not pushed and no PR was created; final response includes proposed title and description.

## Reporting Back

Report concise facts:

```text
Created NILO worktree:
- Path: /home/cx/.herdr/worktrees/nilo/<sanitized-branch>
- Branch: stefan/<feature>
- Base: fresh origin/main
- Port: <PORT>
- Install: pnpm install completed
```

If creation fails, report the exact failing command/output and do not pretend the worktree is ready.

For PR workflow requests, also report the coding-agent result and final PR state:

- Normal PR: include PR URL.
- Draft PR: include draft PR URL.
- Potential PR: include local commit SHA plus proposed PR title and body; explicitly say it was not pushed and no PR was created.

## Common Pitfalls

1. **Accidentally basing new work on stale local `main`.** The helper defaults new branches to freshly fetched `origin/main`; do not override `BASE_REF` unless Stefan wants another base.

2. **Adding `stefan/` to an existing branch.** If Stefan names an existing branch, use it exactly.

3. **Stopping after the script starts.** The helper runs setup and `pnpm install`; wait for it to finish and verify the result.

4. **Manual repo copies.** Use git worktrees through the helper, not `cp -R` or old `nilo-copy-*` patterns.

5. **Ignoring failed dependency install.** If `pnpm install` fails, the worktree exists but is not ready. Report the failure and investigate or ask Stefan how to proceed.

6. **Overwriting existing worktree paths.** The script refuses existing paths. If this happens, inspect existing worktrees rather than deleting anything without explicit permission.

7. **Treating "potential PR" like a real PR.** For a potential PR, commit locally and prepare the PR title/body only. Do not push and do not create the GitHub PR.

8. **Launching the coding agent in the wrong directory.** `omp` must run inside the newly created NILO worktree for the branch, not the source repo or another active worktree.
