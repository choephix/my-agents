---
name: nilo-pr
description: Use when Stefan says /nilo-pr or asks to review/double-review a NILO PR with OMP in Herdr — full self-contained runbook for worktree + Herdr workspace + two-OMP full PR review, plus an OPTIONAL second tab of two-OMP existing-comment validation when comments are requested. Launch and verify, no edits.
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [nilo, pr-review, herdr, omp, worktree, code-review]
    related_skills: [nilo-worktree-setup, herdr-omp, pr-review-two-omp, pr-comment-review-two-omp-herdr, github-operations]
---

# /nilo-pr — NILO PR Review Runbook (self-contained)

This skill is the single entrypoint for Stefan's NILO PR review workflow. **You should not need to read any other skill to execute the happy path** — every command, path, model slug, and verification step you need is here. Only go load a related skill (`nilo-worktree-setup`, `herdr-omp`, `pr-review-two-omp`, `pr-comment-review-two-omp-herdr`, `github-operations`) if this skill is genuinely missing information for an edge case, or a step fails in a way this runbook doesn't cover. If you do find a gap, patch this skill afterward.

## What Stefan Asks For

Default request (a PR URL): **double-review the full PR diff** with two independent OMP reviewers (GPT + Opus).

Add-ons he may request:

- **"in a new tab, check the comments"** / **"validate the Cubic comments"** → ALSO run the OPTIONAL comment-validation sub-task: a second Herdr tab with two more OMP panes that validate the *existing* PR comments (usually Cubic), deciding valid / bullshit / partial. **Only do this part if comments are explicitly requested.** If he only asks for a PR review, build just one tab with two panes and stop there.

Both sub-tasks share the same worktree and Herdr workspace. The agents are **scouts, not editors**: no file edits, no commits, no GitHub posting, no comment resolution.

## Glossary / Conventions (memorize)

- NILO repo: `nilo-technologies/Nilo`, source checkout at `/home/cx/workspace/nilo`.
- Worktrees live under `/home/cx/workspace/nilo-worktrees/`.
- Worktree helper: `/home/cx/workspace/create-nilo-worktree.sh <branch> [folder-name]`.
- OMP binary: `/home/cx/.bun/bin/omp`, needs Bun from mise on PATH (see below).
- Default models: GPT = `openai-codex/gpt-5.5:xhigh`, Opus = `anthropic/claude-opus-4-8:xhigh`. Only deviate if Stefan names a model. Cursor Opus fallback = `cursor/claude-opus-4-8-xhigh` if native Anthropic auth is unavailable.
- Launch OMP in **normal TUI** (watchable), `--auto-approve`. Do **not** use `--mode json` for Herdr panes Stefan watches.
- Artifacts (only if asked): under `/home/cx/workspace/nilo/.agents-local/docs/artifacts/<YYYY-MM-DD dddd>/`, following `/mnt/obsidian-vault/Workspace/Hermes/HOW_TO_WRITE_VAULT_ARTIFACTS.md.md`. Never `.agents-local/artifacts/`.

### PATH export (prepend to every OMP command)

```bash
export PATH="/home/cx/.local/share/mise/shims:/home/cx/.local/share/mise/installs/bun/1.3.14/bin:/home/cx/.bun/bin:$PATH"
```

If `omp` says `env: 'bun': No such file or directory`, this PATH is missing.

## Step 1 — Resolve PR + Branch

```bash
cd /home/cx/workspace/nilo
gh pr view <PR> --repo nilo-technologies/Nilo \
  --json headRefName,headRefOid,baseRefName,title,body,url,files,author
git worktree list --porcelain   # check for an existing worktree on the head branch
```

Capture `headRefName` (branch), `headRefOid` (exact SHA), `baseRefName` (usually `main`).

## Step 2 — Create / Reuse the Worktree

If a clean worktree already exists on the PR head branch, reuse it. Otherwise create one. Name the folder descriptively, e.g. `pr-<PR>-<short>-review`:

```bash
cd /home/cx/workspace
./create-nilo-worktree.sh <head-branch> pr-<PR>-<short>-review
```

The helper assigns a PORT, symlinks `.agents-local`, runs hijack, and runs `pnpm install`.

### pnpm-missing pitfall (common)

The helper calls `pnpm install`. If it fails immediately with `Error: pnpm is not installed or not on PATH`, retry with a temporary shim using the version in `package.json` `packageManager`:

```bash
cd /home/cx/workspace
TMPBIN=$(mktemp -d)
printf '#!/usr/bin/env bash\nexec npx -y pnpm@10.14.0 "$@"\n' > "$TMPBIN/pnpm"
chmod +x "$TMPBIN/pnpm"
PATH="$TMPBIN:$PATH" ./create-nilo-worktree.sh <head-branch> pr-<PR>-<short>-review
```

Confirm the actual version: `node -p "require('/home/cx/workspace/nilo/package.json').packageManager"`. The `Failed to create bin ... isolated-environments / deployment-tools / vercel-deployment` warnings are benign (unbuilt workspace tools); the install still completes.

### Verify worktree before launching

```bash
cd /home/cx/workspace/nilo-worktrees/pr-<PR>-<short>-review
pwd; git branch --show-current; git status --short | wc -l; git rev-parse HEAD
gh pr view <PR> --repo nilo-technologies/Nilo --json headRefOid --jq .headRefOid
readlink .agents-local   # must be /home/cx/workspace/nilo/.agents-local
```

Local HEAD must equal PR `headRefOid` (unless Stefan asks for a different revision); status must be clean; `.agents-local` must be the symlink.

## Step 3 — Gather PR Context Into /tmp

```bash
mkdir -p /tmp/pr<PR>
gh pr view <PR> --repo nilo-technologies/Nilo \
  --json headRefName,headRefOid,baseRefName,title,body,url,files,author > /tmp/pr<PR>/pr-metadata.json
gh pr diff <PR> --repo nilo-technologies/Nilo > /tmp/pr<PR>/diff.patch
# The two comment files are only needed for the OPTIONAL comment-validation sub-task:
gh api repos/nilo-technologies/Nilo/pulls/<PR>/comments  --paginate > /tmp/pr<PR>/review-comments.json
gh api repos/nilo-technologies/Nilo/issues/<PR>/comments --paginate > /tmp/pr<PR>/issue-comments.json
```

When comments are requested, pull BOTH `/pulls/<PR>/comments` (inline) and `/issues/<PR>/comments` (conversation). Print a compact index to separate substantive comments from administrative ones (bot/deploy/linear/vercel):

```bash
jq -r '.[] | "id=\(.id) path=\(.path // "?") line=\(.line // .original_line // "?")\n\(.body)\n---"' /tmp/pr<PR>/review-comments.json
```

## Step 4 — Write the Prompt File(s)

Always write the full-review prompt. Write the comment-validation prompt **only if** comments were requested. Both forbid edits, GitHub posting, and comment resolution; both point at the `/tmp/pr<PR>/` context files.

### 4a. Full PR review prompt → `/tmp/pr<PR>/full-review-prompt.md`

```text
You are one of two independent OMP reviewers. Stefan wants independent model disagreement, so do not optimize for consensus.

Repository: nilo-technologies/Nilo
Worktree: <absolute worktree path>
PR: #<PR> — <url>
Title: <title>
Base branch: <base>   Head branch: <head>   Head SHA: <sha>

Constraints:
- MAKE NO EDITS. No file changes, commits, formatters, autofix, or GitHub posting.
- Review the PR diff against base, not the whole codebase from scratch.
- Do not run tests unless necessary; if you do, use NILO-safe worker limits (--maxWorkers=4 --workerIdleMemoryLimit=1.5G) and never run autofixers.
- Artifact (only if asked): /home/cx/workspace/nilo/.agents-local/docs/artifacts/<YYYY-MM-DD dddd>/, per /mnt/obsidian-vault/Workspace/Hermes/HOW_TO_WRITE_VAULT_ARTIFACTS.md.md.

Context files: /tmp/pr<PR>/pr-metadata.json, /tmp/pr<PR>/diff.patch, /tmp/pr<PR>/review-comments.json, /tmp/pr<PR>/issue-comments.json

Understand the PR goal, then review the full diff for: correctness bugs, regressions, missing edge cases, data/schema mistakes, security/privacy risks, async/state/race bugs, migration/deploy risks, missing or misleading tests, code that contradicts the stated goal.

For each finding: severity (blocker|high|medium|low), file/line, what's wrong, why it matters, suggested fix direction (do NOT implement), confidence. Also: what the PR does, strongest parts, open questions, final verdict.

# PR <PR> review — <your model name>
## Summary
## Findings
## Non-findings / things checked
## Verdict
```

### 4b. (OPTIONAL) Existing-comment validation prompt → `/tmp/pr<PR>/comment-validation-prompt.md`

Only when comments are requested.

```text
You are one of two independent OMP reviewers validating the EXISTING PR comments, not reviewing the whole PR from scratch.

Repository: nilo-technologies/Nilo
Worktree: <absolute worktree path>
PR: #<PR> — <url>    Base: <base>   Head: <head>

Constraints:
- MAKE NO EDITS. No file changes, commits, autofix, GitHub posting, or comment resolution.
- For each substantive comment decide: valid / invalid-bullshit / partially valid / unclear, with code evidence and exact file/function.
- Use one focused investigation per substantive comment (subagent/task if available; otherwise keep them explicitly separate).
- Include inline review comments and issue/conversation comments. Skip administrative/bot comments after noting they are non-substantive.
- Artifact (only if asked): same path rule as full review.

Context: /tmp/pr<PR>/review-comments.json, /tmp/pr<PR>/issue-comments.json, /tmp/pr<PR>/pr-metadata.json, /tmp/pr<PR>/diff.patch

Substantive comments to validate:
<paste each substantive comment: id, path, line, body>

# PR <PR> comment validation — <your model name>
## Summary table
| Comment id | Topic | Verdict | Confidence | Why |
## Per-comment findings
(id/path/line, verdict, evidence, reasoning, fix direction if valid, why wrong if invalid, remaining uncertainty)
## Final recommendation
```

## Step 5 — Build the Herdr Workspace

Create a workspace **rooted at the exact worktree** (workspace identity must match working-tree identity — never reuse the generic `nilo` workspace for a separate worktree).

```bash
WT=/home/cx/workspace/nilo-worktrees/pr-<PR>-<short>-review
herdr workspace create --cwd "$WT" --label "pr-<PR>-<short>" --focus   # returns workspace_id, e.g. w2, root pane w2:p1
```

Layout: **always** a full-review tab with two panes. Add the comments tab with two more panes **only if comments were requested**.

```bash
# Tab 1 — full review (rename the auto-created tab + root pane, then split)
herdr tab  rename w2:t1 "PR<PR> full review"
herdr pane rename w2:p1 "GPT PR<PR> full review"
herdr pane split  w2:p1 --direction right --ratio 0.5 --cwd "$WT" --focus   # -> w2:p2
herdr pane rename w2:p2 "Opus PR<PR> full review"

# Tab 2 — comment validation (ONLY if comments requested)
herdr tab create --workspace w2 --cwd "$WT" --label "PR<PR> comments" --focus   # -> tab w2:t2, root pane w2:p3
herdr pane rename w2:p3 "GPT Cubic validation"
herdr pane split  w2:p3 --direction right --ratio 0.5 --cwd "$WT" --focus   # -> w2:p4
herdr pane rename w2:p4 "Opus Cubic validation"
```

Pane IDs are deterministic (`w2:p1..p4`) but confirm with `herdr pane list --workspace w2 | jq -r '.result.panes[] | [.pane_id,.tab_id,.label] | @tsv'` if anything looks off.

## Step 6 — Launch OMP in Each Pane

```bash
P='export PATH="/home/cx/.local/share/mise/shims:/home/cx/.local/share/mise/installs/bun/1.3.14/bin:/home/cx/.bun/bin:$PATH"'
# Full review (always):
herdr pane run w2:p1 "$P; cd $WT; omp --auto-approve --model openai-codex/gpt-5.5:xhigh @/tmp/pr<PR>/full-review-prompt.md"
herdr pane run w2:p2 "$P; cd $WT; omp --auto-approve --model anthropic/claude-opus-4-8:xhigh @/tmp/pr<PR>/full-review-prompt.md"
# Comment validation (only if requested):
herdr pane run w2:p3 "$P; cd $WT; omp --auto-approve --model openai-codex/gpt-5.5:xhigh @/tmp/pr<PR>/comment-validation-prompt.md"
herdr pane run w2:p4 "$P; cd $WT; omp --auto-approve --model anthropic/claude-opus-4-8:xhigh @/tmp/pr<PR>/comment-validation-prompt.md"
```

Note `@<file>` feeds the prompt file to OMP. Use `--yolo` instead of/with `--auto-approve` only if Stefan asks for yolo.

## Step 7 — Verify Before Reporting

```bash
herdr pane list --workspace w2 | jq -r '.result.panes[] | [.pane_id,.tab_id,.label,.foreground_cwd,.agent_status] | @tsv'
# Confirm the right model/prompt is actually running per pane:
herdr pane process-info --pane w2:p1   # get the omp pid
tr '\0' ' ' < /proc/<pid>/cmdline; echo  # inspect the real command line
herdr pane read w2:p1 --source recent --lines 12 --format text  # optional output peek
```

Confirm: all panes rooted at the worktree, each `omp` process has the intended `--model` and prompt file, `agent_status` is `working`. The `MCP finished with failures ... sentry/vercel/canopy HTTP 401` notice in OMP output is benign (optional MCP servers not authed) — firebase connects fine.

## Step 8 — Report (terse)

```markdown
Launched.
- Herdr workspace: <label>/<id>, rooted at `<worktree>`
- Branch: `<head>`  ·  Local HEAD matches PR head: `<sha>`  ·  Base: `<base>`  ·  Status: clean

| Tab | Pane | Model | Task | Status |
|---|---|---|---|---|
| full review | w2:p1 GPT | openai-codex/gpt-5.5:xhigh | full PR review | working |
| full review | w2:p2 Opus | anthropic/claude-opus-4-8:xhigh | full PR review | working |
| comments | w2:p3 GPT | openai-codex/gpt-5.5:xhigh | validate comments | working |
| comments | w2:p4 Opus | anthropic/claude-opus-4-8:xhigh | validate comments | working |
```

Drop the `comments` rows when that sub-task wasn't requested. Mention any correction made (e.g. pnpm shim, wrong model relaunched).

## Common Pitfalls

1. **Herdr/worktree mismatch.** The workspace must be rooted at the exact worktree, not the generic `nilo` workspace.
2. **pnpm missing.** Use the temp `npx pnpm@<packageManager-version>` shim and rerun the helper.
3. **Trusting branch name only.** Compare local HEAD to PR `headRefOid`.
4. **Incomplete comments.** When validating comments, fetch both `/pulls/<PR>/comments` and `/issues/<PR>/comments`.
5. **`--mode json` for watchable panes.** Don't; use normal TUI so Stefan can watch.
6. **Wrong/silent model.** Verify the running process command line via `/proc/<pid>/cmdline`, not just the launch command.
7. **Agents editing.** Prompts must forbid edits; verify `git status --short` clean before launch.
8. **Bun not on PATH.** Prepend the mise/bun PATH export to every OMP command.
9. **Wrong artifact dir.** If asked for artifacts, use `.agents-local/docs/artifacts/<date>/`, never `.agents-local/artifacts/`.
10. **Doing the comment tab uninvited.** Comment validation is optional — only build it when comments are explicitly requested.

## Verification Checklist

- [ ] PR metadata loaded; head SHA + base captured
- [ ] Worktree created/reused; HEAD equals PR `headRefOid`; status clean; `.agents-local` symlink correct
- [ ] PR diff saved under `/tmp/pr<PR>/`; comment JSONs saved too IF comments requested
- [ ] Full-review prompt written; comment-validation prompt written ONLY if requested; both forbid edits/posting/resolution
- [ ] Herdr workspace rooted at the worktree; full-review tab built; comments tab built only if requested
- [ ] OMP launched with intended model + prompt per pane (TUI, `--auto-approve`)
- [ ] Running process command lines verified; panes `working`
- [ ] Terse launch report delivered, noting any corrections
