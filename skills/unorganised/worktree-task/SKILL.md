---
name: worktree-task
description: Work in a throwaway git worktree branched from the current commit, then land them back as one clean commit on the original branch. Use when the user wants work done "worktree style", off to the side and merged back.
argument-hint: "short slug for the branch/worktree (optional)"
---

Isolate the work in a scratch worktree off the exact current commit; land one clean commit back on the starting branch.

1. Pin the base: `BASE=$(git rev-parse HEAD)` (shell session persists across calls). Pick a kebab `<slug>`.
2. Branch a worktree off it: `git worktree add -b <slug> ~/tmp/worktrees/<slug> "$BASE"`.
3. Do all edits inside `~/tmp/worktrees/<slug>`.
4. Commit there with a real message; note the SHA.
5. Land on the original branch (main tree): `git cherry-pick <sha>`.
6. Verify in the main tree — the worktree has no `node_modules`, so typecheck/tests only run here. On failure: fix + amend in the worktree, `git reset --hard "$BASE"`, re-cherry-pick. Make sure the user doesn't lose any changes they're working on either (stash if you need to).
7. Clean up: `git worktree remove ~/tmp/worktrees/<slug>` then `git branch -D <slug>`.

Never leave the worktree or temp branch behind. One logical change = one commit.

---

If the project is Nilo, there are extra steps to do when setting up a worktree:
- symlink ~/nilo/.agents-local such that the new worktree also has .agents-local/
- now that it has it, run .agents-local/hijack.sh in the new worktree
- confirm that the AGENTS.md file is no longer than 30 lines now; else STOP and ALERT the user
