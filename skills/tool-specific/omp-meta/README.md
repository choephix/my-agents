# omp-transcript

A small Bash + `jq` tool that turns OMP JSONL sessions into compact, self-hydrating transcripts. Structure is carried by XML-like tags — `<user>`, `<assistant>`, `<reasoning>`, `<bash-execution>`, `<file-mention>`, `<tool-call>`, `<tool-result>` — because message bodies contain their own markdown headings; every `#` in a transcript therefore belongs to content, never to structure. Bodies are emitted verbatim, so the output is a reading aid, not parseable XML.

## Usage

```
Usage:
  omp-transcript <session.jsonl|id> [--with-tools|--hydrate] [--reasoning] [--ids] [-m <n>]
  omp-transcript result --session <session.jsonl|id> --message-id <id>
  omp-transcript list [--cwd <dir>] [-n <count>]
  omp-transcript search [--] <pattern> [--regex] [--cwd <dir>] [-n <count>]
                                       [--reasoning] [--with-tools]
                                       [--no-snippet] [--width <chars>]
```

Anywhere a session is expected, pass either a `.jsonl` path or a session id — full or any prefix of at least four characters — resolved under the sessions roots. An existing file wins; an ambiguous prefix lists its candidates and fails.

Every mode accepts `--profile <name|default|all>`, which picks those roots: a named profile is `$HOME/.omp/profiles/<name>/agent/sessions`, `default` is `$HOME/.omp/agent/sessions`, and `all` is the default root plus every profile under it. Without the flag there is one root, `$OMP_SESSIONS_DIR`, or `$HOME/.omp/agent/sessions` when that is unset.

## Render

The default mode renders only the active `parentId` branch, and only what was actually said: user and developer messages, assistant text, shell commands the user ran in the harness, the files they @-mentioned, custom messages, compaction summaries, and branch summaries. Assistant reasoning, tool calls, and tool results are all omitted — in a typical session they dwarf the conversation and distort `-m` counting.

Pass `--with-tools` for a cheap index of that tool traffic: `<tool-call>` blocks with their arguments, and `<tool-result>` blocks whose attributes carry status and UTF-8 byte count and whose body is a copy-pasteable `result` command that hydrates the exact output. The same flag inlines mentioned-file contents, which by default appear only as `<file-mention path="…" lines="…" bytes="…" />` stubs. Pass `--hydrate` to inline the hydrated result bodies too; it implies `--with-tools`. Unrecoverable results are marked `recovered="false"` and keep their placeholder.

Pass `--reasoning` to include `<reasoning>` blocks. Expect roughly double the bytes, and a higher message count: an assistant turn that only thought before calling a tool renders nothing by default, so it occupies no slice slot until this flag brings it back.

Pass `--ids` to put each record's entry id on its opening tag, e.g. `<user id="baa91f06">`. `/fork` copies entries with their ids unchanged, so a block id seen in two sessions marks content the fork inherited from its parent. Every block rendered from one record — an assistant turn's reasoning, text, and tool calls — carries that record's id.

Use `-m <n>` or `--messages <n>` to slice renderable messages: `-5` keeps the last five and `5` keeps the first five, clamped like Python slices. A message is one branch record, so an assistant turn's reasoning, text, and tool calls count once — and a record that renders nothing under the current flags, such as a tool-call-only assistant turn by default, counts not at all.

`omp-transcript session.jsonl -m -5`

Fenced blocks automatically use enough backticks to contain their content safely.

## Result

`result` prints one tool result exactly, with no decoration. Hydration returns ordinary bodies as recorded, replaces raw-output markers and shaken placeholders from readable sidecar artifacts, then falls back for truncated or unresolved shaken placeholders to `displayContent.text`, `truncation.content`, and a readable `resolvedPath`, in that order. If the full output was not recorded, it prints the placeholder, reports the error, and exits 3.

## List

`list` scans the sessions roots and prints sessions newest first. `--cwd <dir>` is resolved with `realpath` and must exactly match the session header's `cwd`. `-n <count>` accepts a positive integer and defaults to 10.

Output is TSV with no header:

```
<mtime as UTC ISO8601 seconds>	<session id>	<title or "-">	<cwd>	<path>
```

## Search

`search` finds the sessions whose conversation contains a pattern, for when the only thing you remember about a session is what was discussed in it. Rows are newest first, and `--cwd` filters exactly as it does for `list`. `-n <count>` defaults to 20; `-n 0` prints every match, and a truncated run reports the full total on stderr.

The pattern is a case-insensitive literal. `--regex` reads it as an Oniguruma regex instead; an invalid pattern is a fatal error. A pattern starting with `-` needs `--` in front of it.

Matching is restricted to what a human said or to prose summarising it: user and developer messages, assistant text, titles, shell commands the user ran, `@`-mentioned paths, compaction summaries, branch summaries, rewind reports, prose notes, and inbound IRC. `--reasoning` adds assistant thinking; `--with-tools` adds tool-call names with arguments, tool results, and mentioned-file contents. Reasoning and tool traffic dominate a session's bytes, so leaving them out is what keeps the default fast and the hits meaningful.

Unlike `render`, every branch of the session is searched, not only the active one — a rewound conversation still happened. Only session files themselves are scanned; a subagent transcript in a session's sidecar is not, though the parent session records the task it was given and the result it returned.

Output is TSV with no header:

```
<mtime as UTC ISO8601 seconds>	<session id>	<hits>	<title or "-">	<cwd>	<path>	<snippet>
```

`<hits>` counts matching messages. `<snippet>` is the match in context, prefixed with the role it came from, preferring the earliest user match and falling back to developer, title, assistant, then anything else; `--width <chars>` sizes it (default 140) and `--no-snippet` drops the column. Control characters inside a snippet become spaces, so a row is always one line.

Two passes run under the hood: GNU grep over raw bytes to pick candidate files, then `jq` over those candidates to confirm the match in visible text and build the row. In literal mode the prefilter uses the pattern's longest run of printable ASCII excluding `"` and `\`, which is the most that survives JSON encoding intact; in regex mode it uses the pattern itself, so a regex written against escape sequences may miss. `OMP_GREP` overrides the grep binary.

A session being appended to right now can end mid-line; that file is re-scanned without its last line rather than skipped.

## Exit codes

- `0`: success, including an empty list.
- `1`: fatal error, such as a missing file, sessions root, or `jq`.
- `2`: usage error.
- `3`: `result` could not recover the full output.

Requires Bash, `jq`, and `realpath`. `search` also requires GNU `grep` and `xargs`.
