---
name: omp-sessions
description: Pull context from Stefan's OMP (Oh My Pi) coding-agent sessions, and from Claude Code sessions, Codex threads and T3 Code threads. Use when Stefan mentions one of those sessions, a session or thread id, or a past conversation, wants to continue one here, asks what was said or decided in one, or asks what was worked on in some period.
---

# OMP Sessions

OMP is Stefan's terminal coding-agent harness. Its sessions are JSONL logs, often huge. Never read them directly. Use `omp-transcript` (on PATH, read-only). It scans every OMP profile by default and renders a session's active branch as markdown with tool results collapsed.

Times in its output are UTC. `--since`/`--until` are read in local time and take `today`, `yesterday`, `3d`, `1w`, `2026-10-06`, `"last monday"`, `"2026-10-06 14:00"`. A date means its midnight; the window is half-open.

For a Claude Code session, a Codex thread or a T3 Code thread, use `agent-transcript` instead. It takes the same flags, renders in the same format, and accepts any of those ids (or an OMP id) as a 4+ character prefix. Its `list` and `search` cover Claude Code and Codex; `omp-transcript list`/`search` cover OMP.

## Find the session

```bash
omp-transcript list -n 10                        # newest first: time, id, title, cwd, path, lineage
omp-transcript list --since today                # sessions active today, every folder
omp-transcript list --under ~/workspace/acme-app --under ~/.herdr/worktrees/acme-app --since 1w
omp-transcript search "pattern" --hits           # matching sessions, each with up to 5 hits (user first): message id, time, snippet
omp-transcript search "pattern" --since 2d --reasoning --with-tools   # narrow when, widen what
```

Forks of one conversation appear once, as the newest fork, with the root session's id in the lineage column (`-` for a root); `--all-forks` lists every one. `--cwd` is an exact folder; `--under` includes subfolders and repeats. An id prefix works in place of a full id or path.

`--no-spawned` hides sessions another agent or a schedule started, read from Paseo's agent records; `--spawned` shows only those. Either adds an origin column (`user`, `agent`, `sched`, or `?` when Paseo never ran the session, which counts as not spawned).

## Read it

```bash
omp-transcript <id> > /tmp/omp-<id>.md           # whole conversation, tool results omitted
omp-transcript <id> -m -3                         # last 3 messages; -m 3 = first 3
omp-transcript <id> --since today                 # only today's part of a long-running session
omp-transcript <id> --around <message-id> -C 3    # a search hit with 3 messages each side, ids shown
omp-transcript <id> --own                         # a fork without the history it copied from its parent
```

Add `--reasoning` for the agent's thinking, `--with-tools` for tool calls. When an omitted result matters, run the `omp-transcript result ...` command printed in its place. Hydrate only what you need.

## Recipes

**A topic from way back.** `search "topic" --hits`; if nothing turns up, add `--reasoning --with-tools`, or `--regex` for variants. For each promising hit, `omp-transcript <id> --around <message-id>`. Cite the session id and message id in your answer.

**What happened today, or this week.** `@omp-session-recap --since today` (or `--since 1w`, `--under <dir>` to narrow to a tree) summarizes every session active in the window with an OMP model. It's slow and costs tokens, so use it when asked or when a dozen transcripts would otherwise be needed. The cheap version: `omp-transcript list --since today`, then `omp-transcript <id> --since today -m -5` per session that matters.

**Continue a session here.** Render the whole transcript, read it, then give Stefan a short recap: the goal, decisions made, the current state, and the open next step. Confirm before you act on it. The session's cwd is the project to work in.

## Caveats

- A fork opens with a copy of its parent's history. Time windows leave that copy out, so `--since today` shows only what was said today; add `--inherited` to count it. Without a window, a fork reads whole unless you pass `--own`.
- A session started in its own worktree (`worktree.onStart`, or `/wt` mid-session) has its cwd under `~/.omp/wt/`, so `--under ~/workspace/<repo>` misses it; add `--under ~/.omp/wt`. Its work lands on a `wt/*` branch of the repo.
- Only the sessions themselves are searched. A subagent's transcript in a session's sidecar is not, but the parent session records the task it was given and the result it returned.
