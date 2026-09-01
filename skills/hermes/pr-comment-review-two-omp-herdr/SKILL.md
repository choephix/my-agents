---
name: pr-comment-review-two-omp-herdr
description: Use when Stefan asks to validate/review PR comments using two independent OMP agents in Herdr, usually GPT and Opus, with no edits.
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [pr-comments, herdr, omp, nilo, code-review]
    related_skills: [github-operations, herdr-multiplexer, omp-oh-my-pi-sessions, nilo-worktree-setup]
---

# PR Comment Review with Two OMP Agents in Herdr

## Overview

This workflow launches two visible OMP reviewers in Herdr to independently validate existing PR comments. The agents are scouts, not editors: they inspect each comment, decide whether it is valid or bullshit, and produce evidence-backed findings without modifying files or posting to GitHub.

The important UX invariant: **Herdr workspace identity must match working-tree identity.** If the target branch lives in a non-default worktree, use a Herdr workspace rooted at that exact worktree. Do not hide work in the generic NILO workspace while operating from `/home/cx/workspace/nilo-worktrees/...`.

## 1. Resolve PR and Exact Branch

Use GitHub metadata first:

```bash
gh pr view <PR> --json headRefName,headRefOid,baseRefName,title,body,url,files,comments,reviews
```

Find an existing worktree for the PR head branch:

```bash
git worktree list --porcelain
```

For NILO, if no suitable worktree exists, create one with the standard helper:

```bash
/home/cx/workspace/create-nilo-worktree.sh <branch-name> [worktree-folder-name]
```

Verify the worktree before launching agents:

```bash
pwd
git branch --show-current
git status --short
git rev-parse HEAD
gh pr view <PR> --json headRefOid --jq .headRefOid
gh pr view <PR> --json baseRefName --jq .baseRefName
ls -ld .agents-local
readlink .agents-local
```

The local `HEAD` must match the PR `headRefOid`, unless Stefan explicitly asks to review a different revision. `git status --short` should be clean before the review starts. For NILO worktrees, `.agents-local` must be a symlink to `/home/cx/workspace/nilo/.agents-local`; do not let agents write artifacts into a worktree-local `.agents-local` directory.

## 2. Open the Right Herdr Workspace

If operating in a new or non-default worktree, create/use a Herdr workspace rooted at that exact path.

Bad shape:

```text
workspace: /home/cx/workspace/nilo
pane cwd: /home/cx/workspace/nilo-worktrees/fix__whatever
```

Good shape:

```text
workspace: /home/cx/workspace/nilo-worktrees/fix__whatever
pane cwd: /home/cx/workspace/nilo-worktrees/fix__whatever
```

Preferred layout:

- Herdr workspace keeps its default (cwd) label, rooted at the exact PR worktree.
- One review tab, labeled short and uniquely descriptive (e.g. `PR<PR> review`).
- Two panes in that tab.
- Both panes have `cwd` and `foreground_cwd` equal to the exact PR worktree.

Useful Herdr commands:

```bash
herdr workspace list
herdr tab create --workspace <workspace_id> --cwd <worktree> --label "PR<PR> review" --focus
herdr pane split <pane_id> --direction right --ratio 0.5 --cwd <worktree> --focus
herdr pane rename <pane_id> "GPT PR<PR> comments"
herdr pane rename <pane_id> "Cursor Opus PR<PR> comments"
herdr pane list --workspace <workspace_id>
herdr pane process-info --pane <pane_id>
```

If Herdr lacks a direct CLI shortcut for creating a workspace rooted at a path, use the available workspace/worktree commands or inspect `herdr --help` / `herdr workspace --help`; do not silently fall back to the wrong workspace.

## 3. Gather PR Comments

Collect both inline review comments and issue/conversation comments. Do not assume `gh pr view --json comments` includes all review-thread context.

```bash
mkdir -p /tmp/pr<PR>
gh api repos/<owner>/<repo>/pulls/<PR>/comments --paginate > /tmp/pr<PR>/review-comments.json
gh api repos/<owner>/<repo>/issues/<PR>/comments --paginate > /tmp/pr<PR>/issue-comments.json
```

Optionally print a compact comment index for sanity:

```bash
jq -r '.[] | "COMMENT_ID=\(.id) PATH=\(.path // "conversation") LINE=\(.line // .original_line // "?") USER=\(.user.login)\nBODY:\n\(.body)\n---"' /tmp/pr<PR>/review-comments.json
jq -r '.[] | "COMMENT_ID=\(.id) USER=\(.user.login)\nBODY:\n\(.body)\n---"' /tmp/pr<PR>/issue-comments.json
```

## 4. Build One Shared Prompt

Write a single prompt file and give it to both OMP sessions.

Required prompt content:

```text
You are one of two independent OMP reviewers. Stefan explicitly wants independent model disagreement/comparison, so do not optimize for speed or consensus.

Repository: <owner>/<repo>
Worktree: <absolute worktree path>
PR: #<PR> — <url>
Title: <title>
Base branch: <base>
Head branch: <head>

Critical constraints:
- MAKE NO EDITS. Do not modify files, apply fixes, commit, run formatters that write, or use autofix commands.
- Review the PR comments, not the whole PR from scratch.
- For each substantive comment: decide whether the comment is valid, invalid/bullshit, partially valid, or unclear.
- Explain reasoning with code evidence and exact files/functions.
- If a comment depends on another comment for context, give that context to the relevant sub-agent.
- Spin/use sub-agents/tasks: one focused sub-agent per substantive comment. Each sub-agent investigates exactly one comment. If the environment has a Task/subagent tool, use it; otherwise simulate the structure explicitly but keep investigations separate.
- Include inline review comments and issue/conversation comments. Skip purely administrative/acknowledgement comments after noting that they are non-substantive.
- Do not post to GitHub. Do not resolve comments.
- If you write an artifact, it must go under `/home/cx/workspace/nilo/.agents-local/docs/artifacts/<YYYY-MM-DD dddd>/`, following `/mnt/obsidian-vault/Workspace/Hermes/HOW_TO_WRITE_VAULT_ARTIFACTS.md.md`. Do not write artifacts to `.agents-local/artifacts/`.

Local context:
- Inline review comments JSON: /tmp/pr<PR>/review-comments.json
- Issue/conversation comments JSON: /tmp/pr<PR>/issue-comments.json

Final answer format:

# PR <PR> comment validation — <your model name>

## Summary table
| Comment source/id | Topic | Verdict | Confidence | Why |
|---|---|---|---|---|

## Per-comment findings
For each substantive comment:
- Comment id/source/author/path/line if available
- Verdict: valid / invalid-bullshit / partially valid / unclear / non-substantive
- Evidence: exact code/tests/behavior inspected
- Reasoning
- If valid: suggested fix direction (do not implement)
- If invalid: why the comment is wrong
- Remaining uncertainty, if any

## Final recommendation
Which comments Stefan should act on, which can be ignored, and which need follow-up evidence.
```

Save it somewhere like:

```bash
/tmp/pr<PR>/pr<PR>-comment-review-prompt.md
```

## 5. Launch Two OMP Panes

Use normal TUI mode so Stefan can watch. Do not use `--mode json` for watchable Herdr launches.

Use `--yolo` when requested.

Model mapping:

- GPT: `openai-codex/gpt-5.5:xhigh`
- Cursor Opus: `cursor/claude-opus-4-8-xhigh`
- Native Anthropic Opus: only when explicitly requested

Commands:

```bash
export PATH="/home/cx/.local/share/mise/shims:/home/cx/.local/share/mise/installs/bun/1.3.14/bin:/home/cx/.bun/bin:$PATH"
cd <worktree>
omp --yolo --model openai-codex/gpt-5.5:xhigh @/tmp/pr<PR>/pr<PR>-comment-review-prompt.md
```

```bash
export PATH="/home/cx/.local/share/mise/shims:/home/cx/.local/share/mise/installs/bun/1.3.14/bin:/home/cx/.bun/bin:$PATH"
cd <worktree>
omp --yolo --model cursor/claude-opus-4-8-xhigh @/tmp/pr<PR>/pr<PR>-comment-review-prompt.md
```

Run them via Herdr panes, for example:

```bash
herdr pane run <gpt_pane> '<gpt command>'
herdr pane run <opus_pane> '<opus command>'
```

If the wrong model is launched, stop that process group and relaunch in the same pane with the correct model. Verify with `herdr pane process-info`.

## 6. Verify After Launch

Before telling Stefan it is ready, verify:

```bash
# branch and PR head
cd <worktree>
printf 'pwd='; pwd
printf 'branch='; git branch --show-current
printf 'status_count='; git status --short | wc -l
printf 'local_head='; git rev-parse HEAD
printf 'pr_head='; gh pr view <PR> --json headRefOid --jq .headRefOid
printf 'base='; gh pr view <PR> --json baseRefName --jq .baseRefName

# panes and models
herdr pane list --workspace <workspace_id>
herdr pane process-info --pane <gpt_pane>
herdr pane process-info --pane <opus_pane>
```

Confirm:

- Herdr workspace is rooted at the target worktree.
- Both panes have `cwd` and `foreground_cwd` equal to the worktree.
- GPT pane command contains `--model openai-codex/gpt-5.5:xhigh`.
- Opus pane command contains the requested Opus route, usually `--model cursor/claude-opus-4-8-xhigh`.
- Both commands include `--yolo` when requested.
- Worktree branch and HEAD match the PR head.
- Worktree is clean before review starts.

## 7. Report Back

Keep the launch report terse:

```markdown
Launched.

- Herdr workspace: <label/id>, rooted at `<worktree>`
- Tab: <label/id>
- Branch: `<branch>`
- Local HEAD matches PR head: `<sha>`
- Status: clean

| Pane | Model | Status |
|---|---|---|
| `<pane>` — GPT PR<PR> comments | `openai-codex/gpt-5.5:xhigh` | working |
| `<pane>` — Cursor Opus PR<PR> comments | `cursor/claude-opus-4-8-xhigh` | working |
```

Mention any correction made, such as killing an accidentally-launched native Anthropic Opus and relaunching Cursor Opus.

## Common Pitfalls

1. **Herdr/worktree mismatch.** Do not reuse the main NILO workspace while operating in a separate worktree.
2. **Wrong Opus route.** If Stefan says Cursor Opus, use a Cursor Opus model, not native Anthropic.
3. **Incomplete comments.** Pull both `/pulls/<PR>/comments` and `/issues/<PR>/comments`.
4. **Agents editing files.** The prompt must forbid edits; still verify `git status --short` before launch and after if needed.
5. **Trusting branch name only.** Compare local `HEAD` to PR `headRefOid`.
6. **Non-watchable launch mode.** For Herdr panes Stefan watches, use normal TUI mode, not `--mode json`.
7. **Silent model drift.** Verify the running process command lines with `herdr pane process-info`.
8. **Sub-agent ambiguity.** Tell OMP to use one sub-agent/task per substantive comment, and to keep investigations separate even if it must simulate that structure.

## Verification Checklist

- [ ] PR metadata loaded from GitHub.
- [ ] Exact PR branch worktree resolved or created.
- [ ] Worktree `HEAD` equals PR `headRefOid`.
- [ ] Worktree status is clean before launch.
- [ ] Herdr workspace is rooted at the same exact worktree.
- [ ] Review tab has two panes, both rooted at the worktree.
- [ ] Inline review comments and issue comments were saved to `/tmp/pr<PR>/`.
- [ ] One shared prompt was written and used for both agents.
- [ ] Prompt says no edits, no GitHub posting, one sub-agent per substantive comment, and artifacts (if any) go under `.agents-local/docs/artifacts/<YYYY-MM-DD dddd>/` with proper frontmatter.
- [ ] GPT pane uses the requested GPT model.
- [ ] Opus pane uses the requested Opus provider/model, especially Cursor Opus when requested.
- [ ] Both panes include `--yolo` if Stefan requested it.
- [ ] Running process command lines were verified before reporting success.
