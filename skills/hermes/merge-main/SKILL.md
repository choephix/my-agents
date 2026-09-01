---
name: merge-main
description: Merge latest origin/main into the current branch. Use when asked to update/sync/catch a branch up to main, merge main in, or resolve conflicts against main.
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [git, merge, origin-main, conflicts, branch-sync]
    related_skills: [github-operations]
---

Bring the current branch up to date with **origin/main**.

- Local `main` is likely stale — never trust it. `git fetch origin` first, then merge `origin/main`.
- Merge, not rebase.
- Each conflict: read both sides. Deeply understand *why* each side changed — the intent and goal, not just the diff. Resolve so both intentions survive.
- Doubt → favor main. The branch adapts to main, never the reverse.
- After resolving, ask the user whether to run formatting, typecheck, or build.
