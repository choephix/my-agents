---
name: omp-meta
description: Operate on agent sessions (OMP, Claude Code, Codex, T3 Code threads): read, list, slice, compare transcripts, resolve session IDs. Use only when the user explicitly asks for this; NEVER infer.
---

# omp-meta

Renders any OMP session's active branch, including your own: a metadata header, then one XML-like block per message — `<user>`, `<assistant>`, `<reasoning>`, `<bash-execution>`, `<file-mention>`, `<tool-call>`, `<tool-result>`. Any markdown heading you see inside a block is that message's own content; the structure never uses headings. Work **narrow-first**: every widening multiplies tokens, so escalate only when the answer isn't in view.

## Addressing a session

Anywhere a path is expected, a session id — full or a 4+ character prefix — works: `omp-transcript 019fd76e -m -1`. An ambiguous prefix lists its candidates and fails.

Sessions are stored per OMP profile. Every profile is scanned by default; `--profile <name|default>` narrows to one, and `$OMP_SESSIONS_DIR`, when set, replaces the roots.

## Time windows

`--since <when>` / `--until <when>` work in every mode: `today`, `yesterday`, `3d`, `1w`, `2026-10-06`, `"last monday"`, `"2026-10-06 14:00"`, read in local time. A date means its midnight; the window is half-open. `list` and `search` keep sessions with activity in the window (and `search` only counts hits inside it); render keeps only the messages inside it. Output times are UTC.

A fork opens with a copy of its parent's history, stamped with the fork's own time. Windows leave that copy out, so a fork made today doesn't drag old history into `--since today`; `--inherited` puts it back. Render `--own` drops the copy even without a window — what the fork itself added.

## Find the session

Only remember what was said? Search content:

```bash
omp-transcript search <pattern> [--hits] [--since <when>] [--under <dir>] [-n <count>]
# e.g. omp-transcript search 'puppet terminology' --hits --since 2w
```

TSV, newest first: `mtime  id  hits  title  cwd  path  lineage  snippet`. Default n=20, `-n 0` prints every match. The pattern is a case-insensitive literal; `--regex` reads it as a regex instead. `--hits [n]` lists up to n matching messages under each row, user messages first, as `\t<message id>\t<time>\t<role>: <snippet>` — the ids feed `--around`.

Searched by default: user and assistant messages, titles, shell commands the user ran, @-mentioned paths, and conversation summaries. `--reasoning` adds thinking and `--with-tools` adds tool calls and results — both widen the haystack, and the snippet names which one matched.

Know the directory, or the day? List:

```bash
omp-transcript list [--cwd <dir>] [--under <dir>]... [--since <when>] [-n <count>]
# e.g. omp-transcript list --cwd "$PWD" -n 12
# e.g. omp-transcript list --since today
```

TSV, newest first: `mtime  id  title  cwd  path  lineage`. Default n=10, `-n 0` for all.

- **Skip-self:** drop the row whose id (column 2) equals your own session ID.
- `--cwd` is an exact realpath match; `--under` also matches subdirectories and may repeat.
- **Forks collapse:** one row per conversation, the newest fork, with the root session's id in the lineage column (`-` for a root). `--all-forks` shows every one.
- **Spawned:** `--no-spawned` drops sessions another agent or a schedule created; `--spawned` keeps only those. Both read Paseo's agent records and add an `origin` column after lineage: `user`, `agent`, `sched`, or `?` (Paseo never ran it: terminal, herdr, `omp -p`; counts as not spawned). Same flags on `search`.
- Already holding an id? Skip both and pass the id straight to the tool.
- Need the last message? Use `-m -1`.

Done when: you hold the `.jsonl` path of every target session.

## Read it

```bash
omp-transcript <path> -m -5                      # slice: last 5 messages
omp-transcript <path> --since today              # only today's messages
omp-transcript <path> --around <message-id> -C 3 # a search hit in context, ids shown
```

`-m` is a py/js slice: `-5` = last five, `5` = first five; clamped, never errors. One message = one branch record, so an assistant's reasoning, text, and tool calls count once. `--around` renders the branch through that message — a hit on a rewound branch reads in its own context — with up to `-C` messages each side.

Reasoning, tool calls, and tool results are all omitted by default — in a typical session they dwarf the conversation, and hiding them keeps `-m` slicing what was actually said.

Widen in order, only on need:

1. Bigger slice, or drop `-m` — the whole conversation.
2. `--reasoning` — the author's thinking. Roughly doubles the bytes.
3. `--with-tools` — tool calls with arguments, one stub per result carrying the `result` command that hydrates it, and the contents of any `<file-mention>` (paths and sizes are always shown).
4. `omp-transcript result --session <path> --message-id <id>` — hydrate ONE output.
5. `--hydrate` — every result body inline. Hundreds of KB; last resort.

Exit 3 from `result` = that output was never recorded in the session. Report it; do not retry or work around.

Done when: every claim you make about another session cites its path and the message it came from.

## Many sessions at once

`@omp-session-recap [dir] [--under <dir>]... [--since <when>] [--until <when>]` summarizes every session in scope with an OMP model; `--since today` alone covers every folder. Slow and token-hungry: only when asked, or when a dozen transcripts would otherwise be needed.

## Claude Code, Codex and T3 Code

`agent-transcript` renders Claude Code and Codex sessions in the same block format, with the same flags and the same narrow-first ladder: `-m`, `--around`/`-C`, `--since`/`--until`, `--reasoning`, `--with-tools`, `--hydrate`, `--ids`, `result`, `list`, `search`. It takes a path or any 4+ character prefix of a Claude Code session id, Claude Code subagent id, Codex thread id, or T3 Code thread id. A T3 thread renders the Claude Code or Codex session it runs on. An OMP id goes to `omp-transcript` unchanged, so `agent-transcript <any id>` works for all four.

```bash
agent-transcript 7380d76d -m -5                      # a T3 thread: last 5 messages of its Claude Code session
agent-transcript list --source codex --since today   # list and search cover Claude Code and Codex, not OMP
agent-transcript search 'favicon' --hits
```

Where it differs from OMP:
- A Claude Code subagent's tool result carries `subagent="<path>"`; render that path to read the subagent.
- Codex message ids are line numbers (`L42`). Codex compactions are encrypted, so they render as a bare `<compaction />`.
- Injected context renders only with `--with-tools`, as `<custom-message>`: skill bodies, system reminders, AGENTS.md, environment context, developer messages.
- `--own`, `--inherited` and `--profile` apply to OMP sessions only. `result` prints whatever the session recorded and never exits 3.

## Sidecar anatomy

A session's sidecar directory is its path minus `.jsonl` (`sdir=$(echo ~/.omp/agent/sessions/*/*_"$sid")`). Inside: spilled outputs as `<N>.bash-original.log` (artifact://N) and `<N>.shake.log` (shaken regions); subagent transcripts as `<Name>.jsonl` + `<Name>.md`. The tool's hydration already reads these — go direct only when bypassing it.

Full CLI detail: `README.md` in this skill's directory.

## Notes

Don't read more than you are asked to. If the user requests specific sessions or messages, assume they are trying to protect your context window from getting filled with bloat.
