# .Agents

> Prompts like pressed flowers  
> kept between markdown pages  
> blooming on demand

## Skills

- [Dry Dev](skills/dry-dev) — Rehearse an implementation as exact commands and diffs, executing nothing.
- [Merge Main](skills/merge-main) — Bring a branch up to date while preserving main’s intent and patterns.
- [Pith](skills/pith) — Dense, plain writing that respects the reader’s attention.
- [PR Byline](skills/pr-byline) — Mark AI-authored PR comments so readers never mistake them for yours.
- [PR Description](skills/pr-description) — Write concise PR descriptions from the reviewer’s seat.
- [Spoiler Surfer](skills/spoiler-surfer) — Surf future-story spoilers a coy word or two at a time.

## Extensions

Symlink a folder into `~/.omp/agent/extensions/` (or a profile's) to enable it.

- [prose](.omp/extensions/prose) — `/prose` distills or forks a conversation into readable prose; `^N` trims in place, keeping the last N turns verbatim.
- [pivot](.omp/extensions/pivot) — `/pivot` keeps one message verbatim and summarizes everything before it.
- [minimap](.omp/extensions/minimap) — `/minimap` opens a keyboard-driven outline of the session.
- [skill-directives](.omp/extensions/skill-directives) — `@imports` and `` !`shell` `` expansion in SKILL.md.
- [delay-message](.omp/extensions/delay-message) — `/delay` schedules a prompt, kept out of context until it fires.
- [usage-guard](.omp/extensions/usage-guard) — enforces provider usage thresholds with warnings, subagent draining, or a global pause.
- [session-id](.omp/extensions/session-id) — tells the model which session it is running in.
- [stage-note](.omp/extensions/stage-note) — `/stage` appends text to context without starting a turn.

### Usage Guard

Configure `usage-guard` in `$PI_CODING_AGENT_DIR/usage-guard.json` (normally
`~/.omp/agent/usage-guard.json`):

```json
{
  "pollSeconds": 60,
  "forceRefreshSeconds": 60,
  "staleAfterSeconds": 180,
  "commandTimeoutSeconds": 20,
  "rules": [
    {
      "provider": "openai-codex",
      "window": "7d",
      "thresholdPercent": 50,
      "action": "drain-subagents"
    },
    {
      "provider": "anthropic",
      "window": "5h",
      "thresholdPercent": 90,
      "action": "pause"
    }
  ]
}
```

The guard starts **inactive in every session**. Enable it only when wanted:

```text
/usage-guard activate
```

Each rule must select an exact `limit`, `window`, or both from
`omp usage --json --provider <provider>`. Actions are `warn`,
`drain-subagents`, and `pause`; the strongest crossed action wins.
`drain-subagents` blocks new `task` calls without cancelling running jobs.
`pause` engages OMP's process-global pause gate. Acknowledgements are scoped
to the current quota window, so a provider reset automatically re-arms rules.
In headless modes, `pause` degrades to draining new subagents rather than
engaging a gate with no resume UI. If fresh data for an enforcement rule is
unavailable, new `task` calls are blocked conservatively.

Use `/usage-guard deactivate` to stop all enforcement immediately for the
current session. `/usage-guard status`, `/usage-guard reload`, and
`/usage-guard resume [provider]` inspect, reload, or acknowledge active rules.

## Herdr Plugins

Link a folder with `herdr plugin link <path>` to enable it.

- [OMP Fork Pane](.herdr/plugins/omp-fork-pane) — `prefix+shift+f` forks into a right-hand pane; `prefix+f` opens an OMP sidecar tab.
- [PR Worktree](.herdr/plugins/pr-worktree) — `prefix+p` asks for a PR number/URL and lands you in a worktree workspace for it.
- [Tab Namer](.herdr/plugins/tab-namer) — names unnamed tabs from agent conversations; agentless tabs get live foreground-process labels.

## Tools

Standalone applications and background daemons.

- [shadow-agent](tools/shadow-agent) — Background observer generating structured journals, commits, or telemetry from active sessions.
- [omp-session-recap](tools/omp-session-recap) — `@omp-session-recap [dir]`: summarizes every OMP session recorded in a folder with OMP's compaction prompts, after dropping fork-inherited and repeated text, then offers to open OMP there with the recap already in context.

## Scripts

Single-file CLI utilities.

- [pr-triage](scripts/pr-triage) — Score and rank open GitHub pull requests by yield-vs-effort.
- [link-doctor](scripts/link-doctor) — Check and repair broken markdown links across doc trees.
