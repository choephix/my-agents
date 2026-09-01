---
name: omp-herdr-spinoff
description: Spin the current tangent off into its own worktree, Herdr workspace, and fresh OMP session(s) with a focused brief.
disable-model-invocation: true
argument-hint: "what to spin off"
---

Hand the tangent off without working on it yourself.

1. **Name the spinoff.** One kebab `<slug>` for branch and worktree alike: key words first, short, distinctive (collision-proof). Slug alone tells what the work is. An existing branch is fine — the script reuses it instead of cutting from main.

2. **Write the brief** to `/tmp/spinoff-<slug>.md`:
   - **Objective** — one sentence plus checkable acceptance criteria; the criteria are the fence. Add an explicit "out" only for an over-reach the objective itself tempts (a refactor, extra tests) — never to describe the master task the fresh agent can't see anyway.
   - **Context** — everything this conversation learned that the next agent needs: exact file paths, symbols, repro steps, error text, decisions already made and why. Quote from the live conversation; don't paraphrase from memory.
   - **Delivery** — verify narrowly, one atomic commit on `<slug>`, no merge; Stefan integrates later from the spinoff's own tab.

   Match detail to what the spinoff needs, not to this conversation's length. Redact secrets — say where they live instead.
   Done when a fresh agent could start from the brief alone, zero questions.

3. **Launch with the script** (in this skill's folder; `-h`-less — flags documented in its header):

   ```bash
   spinoff.sh -b <slug> -f /tmp/spinoff-<slug>.md [-m <model>]... [-t <tab-desc>] [-r <repo>]
   ```

   It fetches origin, resolves the base (existing branch → its head; else `origin/main`), cuts the worktree as its own workspace labelled `<slug>`, names the tabs `<slug>-<model>[-<desc>]`, launches one omp per `-m` on the brief, and verifies each pane has a live omp inside the worktree. Pass `-r` when the work belongs to a different repo than the session's cwd (e.g. master sits in nilo-wayfinder, work is in `~/workspace/nilo`).

   Multi-agent: repeat `-m` (e.g. `-m sol -m opus`) for an adversarial review — one workspace, one checkout, one tab per model, all on the same brief. Shared checkout suits read-mostly work; give each model its own output file in the brief ("Sol writes `review-sol.md`, Opus writes `review-opus.md`"). Two *implementers* want two spinoffs, not two tabs.

4. **Confirm real work.** Script success means omp is alive; now `herdr pane read <pane>` must show skill loads, file reads, progress. A welcome screen or auth error is a failed launch, not a launch.

5. **Reply with one line** from the script's output: worktree path, branch @ base, workspace + panes, brief path.

Pitfalls:
- Bare `herdr` auto-targets your own session via the pane env — don't reach for `--session` just because others are live.
- Never `cd` this session into the new worktree — the whole point is that the master stays put.
