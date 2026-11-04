---
name: settle-herdr-session
description: Settle every agent pane in one Herdr session: secure what lives only in chat, raise what's urgent, close.
disable-model-invocation: true
argument-hint: "<herdr session> [workspace or pane scope]"
---

Stefan keeps many agent panes open in Herdr. Closing one keeps its transcript but ends its **watcher**: nobody follows up on its open questions, promised steps, unpushed work, or the risks it noticed. To **settle** a pane is to hand each of those to a durable owner (a pickup point on disk, a reminder Stefan sees, or Stefan himself right now) and then close it.

You run the settle. Each pane's agent holds the context and does the writing; you brief it, check its claims against the world, and decide.
Herdr control: `herdr --skill`. Transcripts: `omp-transcript`, `agent-transcript`.

## Done when
- Every pane in scope is closed, or open with a one-line reason.
- Every item any pane surfaced has an owner by tier. Nothing rests on chat alone, this session's included.
- Stefan has the report.

## Stakes tiers
For every open item ask: if Stefan never hears of it again, what does he lose, and by when? Unsure → one tier up.
- **Alarm**: loss on a clock, or already under way. An exposure; money in flight; an expiry, renewal or deadline within 30 days; something he relies on that is down; work that exists only where it will be wiped (uncommitted in a worktree, `/tmp2`, a process's memory); a promise to another person.
  File a reminder with `due`, then end your turn with the alarm at the top so he sees it now. That pane stays open.
- **Reminder**: matters, no near clock. A decision blocking a goal he still wants; a standing risk (data without backup, a lost route home, a far expiry); a human-only step.
  File a reminder, dated when the world gives a date; list it under Needs Stefan.
- **Note**: preferences, optional ideas, unanswered "want me to…?" offers. Pickup point and memo `attention`.
Reminders: `collections` skill. Search existing reminders first; extend a match instead of filing a twin.

## The gate
A pane is safe to close when a fresh agent holding only the disk can answer: where are we, what's next, what was Stefan worried about.
The pickup point carries, as relevant:
- goal and constraints in Stefan's words
- each decision labelled: Stefan decided / agent recommended / open
- state checked today, dated, with its recheck command
- the plan or artifact itself, in full
- rejected alternatives and why; earlier mistakes and their corrections
- blockers, each with an owner
- session id and resume command
- Drift Watch: facts that will rot, why, recheck command
Finished work committed where it belongs, with nothing open, passes as is.
You verify the gate yourself: files exist, commits exist, nothing in the transcript is missing from the note.

## Per pane
Skip your own pane, panes whose agent is working or blocked, and panes Stefan writes to during the run.
Every prompt you send a pane names its limits: write and commit notes only; push, publish, spend and live-system changes come back to you as requests.
1. Probe: the pane's agent lists its loose ends and every risk or clock it knows of.
2. Re-ground: it rechecks each against the world today. Old sessions are wrong about the world, and the drift is where alarms hide.
3. Tier: you tier every item. Alarms go out now.
4. Persist: it writes the pickup point in the workspace's own home and term (that folder's `AGENTS.md`: effort, endeavor, ticket); no home → the efforts directory named in `~/.config/my-agents/local.md`, under a slug for the topic. Extend an existing note before starting one.
5. Audit: an Opus reviewer reads transcript and note side by side and lists what is missing, wrong, stated more surely than observed, or risky but untiered. The pane's agent fixes each.
6. Gate. A failed gate loops to Persist.
7. Close and memo: `~/workspace/my-agents/skills/tool-specific/triage-omp-sessions-to-close/SKILL.md` § Act on the decision. A tab whose other panes run live processes (servers, jobs) stays.

## Across panes
- Panes on one topic (forks, neighbours): one pickup point, split by blast radius; the other session's content marked recorded or proposed; the other file becomes a one-line pointer.
- An entry-point doc (orientation file, README) that contradicts a pickup point gets fixed in the same pass.
- Panes sharing a repo commit one at a time.

## Boundaries
Act alone: read-only checks; writing notes; local commits to repos that are private or have no remote (check `gh repo view --json visibility`), staging only that pane's files; closing panes that pass the gate.
Ask Stefan, pane left open: any push; spending; live infrastructure or provider settings; deleting a file this run didn't create; sessions disagreeing about something he decided.

## Report
Alarms first, including ones already sent. Then:
- Needs Stefan: reminders filed, by title.
- Closed: topic → pickup path.
- Kept open: reason.
This session is the last watcher: it stays open until Stefan has read the report.
