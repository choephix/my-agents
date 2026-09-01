---
name: ttt-feature
description: Ship ttt changes through Stefan's personal fork: branch from mine, verify, PR back to mine, merge, push, and reinstall so the next ttt execution runs the change. Use when the user asks to change ttt.
argument-hint: "feature or fix to ship"
---

Ship each ttt change all the way into the executable Stefan runs. The repository is `~/forkspace/ttt`; `origin` is `choephix/ttt`, `upstream` is `eugenioenko/ttt`, and `mine` is the personal integration branch.

1. **Start clean and current.** In the repository, confirm the remotes and inspect the branch and working tree. On a clean tree, run `./scripts/up.sh`. Never discard, overwrite, or mix unrelated user changes; if they prevent the lifecycle, preserve them and report the exact blocker. This step is complete when local and `origin/mine` contain current `upstream/main`, the tree is clean, and `mine` is checked out.

2. **Cut one branch.** Create `fix/<kebab-slug>` for broken behavior or `feat/<kebab-slug>` for new behavior from `mine`. If the requested work already has a dedicated branch, reuse it only after confirming its base and scope. This step is complete when the checked-out branch contains only the requested change relative to `mine`.

3. **Make it real.** Trace the existing behavior, implement the change at its source, migrate every affected caller, and add focused tests for the observable contract. Preserve existing conventions and remove superseded code. This step is complete when the requested behavior works end to end and every affected path is accounted for.

4. **Prove it.** Run the narrow tests while iterating, then the touched packages and a focused smoke scenario that exercises the user-visible behavior. Fix failures rather than narrowing the check. This step is complete when the new test would fail on the old behavior, all touched-package tests pass, and the smoke scenario succeeds.

5. **Commit a reviewable unit.** Review the diff, commit the complete change with a conventional commit message, and require a clean tree. Do not include generated binaries or unrelated cleanup. This step is complete when one coherent commit series represents the feature and `git status --short` is empty.

6. **Open the fold-in PR.** Push the feature branch to `origin` and open a GitHub PR in `choephix/ttt` with base `mine`. The PR body states the user-visible result and exact verification performed. Do not target upstream automatically; upstream submission is a separate judgement call. This step is complete when the PR exists and its diff contains only this feature.

7. **Fold into mine.** Merge the feature branch into local `mine` with `--no-ff`, push `mine` to `origin`, and confirm GitHub recognizes the PR as merged. Keep `main` an upstream mirror; never place personal commits there. This step is complete when local and `origin/mine` contain the merge commit, the PR is merged, and `mine` is checked out with a clean tree.

8. **Install the committed build.** Run `make install`; if Go is not on `PATH`, run `mise exec go@1.24.4 -- make install`. Confirm `~/.local/bin/ttt` is first in resolution, `ttt --version` identifies the new clean commit without `-dirty`, and rerun the focused smoke scenario against the installed executable where practical. This step is complete only when the next plain `ttt` invocation runs the shipped change.

Report the branch, PR URL, merge commit, installed version, and verification evidence. Never call a change shipped while it exists only in a feature branch, only in source, or only in `bin/ttt`.
