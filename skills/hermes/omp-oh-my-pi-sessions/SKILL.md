---
name: omp-oh-my-pi-sessions
description: Use when Stefan asks to start an Oh My Pi/OMP session, find OMP sessions for a project, read the last message from an OMP session log, or compare final messages across OMP sessions.
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [omp, oh-my-pi, sessions, logs, coding-agent]
    related_skills: [nilo-worktree-setup, autonomous-coding-agents]
---

# OMP / Oh My Pi Sessions

## Overview

Use this skill for two recurring jobs:

1. Start a new Oh My Pi coding-agent session with `omp`, optionally using a requested model.
2. Inspect OMP session logs without flooding context: find sessions for a project, extract only the last user/assistant message from one or more logs, and compare where final agent outputs align or diverge.

OMP keeps project-scoped JSONL logs under:

```text
~/.omp/agent/sessions/<encoded-project-path>/*.jsonl
```

For example:

```text
/home/cx/workspace/nilo      -> ~/.omp/agent/sessions/-workspace-nilo/*.jsonl
/home/cx/workspace           -> ~/.omp/agent/sessions/-workspace/*.jsonl
/mnt/obsidian-vault/         -> ~/.omp/agent/sessions/--mnt-obsidian-vault--/*.jsonl
```

The JSONL files can be large. Do not use `read_file` on the whole log just to get the final answer. Use a small script that streams the file and keeps only the last matching message.

## When to Use

Use this skill when Stefan asks things like:

- “Start a new session with Oh My Pi.”
- “Start OMP with model `<model>`.”
- “Send this message to that OMP session.”
- “Continue the latest OMP session in this project.”
- “Find the OMP session for this project where I asked for a plan/review.”
- “Read the last message from that OMP session.”
- “Compare the last messages from these two/three OMP sessions.”
- “Tell me where the agents align and diverge.”

Do **not** use this skill for Hermes session history; use `session_search` for Hermes conversations.

## Starting a New OMP Session

Run OMP from the intended project directory so its edits, project discovery, and session log are scoped correctly.

### Basic start

```bash
cd /path/to/project
omp "<clear task prompt>"
```

### Start with a specific model

```bash
cd /path/to/project
omp --model <model> "<clear task prompt>"
```

When you will need to resume/orchestrate the session later, prefer JSON mode so the session header/events expose the session id immediately:

```bash
cd /path/to/project
omp --mode json --model <model> "<clear task prompt>"
```

Capture the printed session id/path and resume that exact session. Do not infer by “latest” unless debugging a missed capture.

### Non-interactive output

Use this when Stefan wants a direct one-shot answer instead of an interactive session:

```bash
cd /path/to/project
omp --print "<clear task prompt>"
```

## Continuing an Existing OMP Session for Stefan

Use this when Stefan asks you to “send this to OMP,” “continue that OMP session,” “tell Kimi/GPT/Opus what it missed,” or add a user message in his place so work can continue without him SSHing in.

If the user names an agent/model from a prior comparison (“tell Kimi…”, “ask GPT…”) and the intent is clearly to continue that agent’s prior OMP conversation, **resume that exact session**. Do not start a fresh same-model session with a summarized prompt unless the user explicitly asks for a new session.

Do **not** edit the JSONL session file by hand. Resume through OMP’s CLI so the conversation, tool state, session metadata, and append semantics stay owned by OMP.

### Resume how-to

```bash
# Resume a specific session by id prefix, full id, or JSONL path
cd /path/to/project
omp --resume <session-id-or-jsonl-path> "<Stefan's message>"

# Resume with JSON events/header when the caller needs deterministic session/event capture
cd /path/to/project
omp --mode json --resume <session-id-or-jsonl-path> "<Stefan's message>"

# Resume a specific session with a specific model
cd /path/to/project
omp --model <model> --resume <session-id-or-jsonl-path> "<Stefan's message>"
```

Always resolve the intended session and use `--resume <session-id-or-jsonl-path>`. Do not use `--continue`; it is too unpredictable for Stefan's workflow.

### Capturing session IDs for later resume

Preferred order:

1. Capture the session id/path from OMP stdout or a machine-readable OMP flag/API if available.
2. If OMP does not expose it directly, plant a unique token in the first prompt and locate the JSONL by exact token + matching `session.cwd` + model line when available.
3. Parse first-line `session.id`; store both id and JSONL path.

Do not rely on “latest session for cwd” as the normal path. It is race-prone when multiple OMP sessions start close together. Use it only as a diagnostic fallback.

### Continuation workflow

1. Resolve the intended project/worktree and session. If Stefan says “latest,” discover the latest matching session by `session.cwd` and then resume that explicit session path/id.
2. Extract the last assistant message with the streaming last-message script before resuming if context matters. Summarize it briefly to yourself; do not load the full log.
3. Run `omp --resume <session> "<message>"` from the same project/worktree. Use `terminal(background=true, notify_on_complete=true)` for substantial work.
4. When OMP finishes, extract its new last assistant message using the streaming extractor and report the result back to Stefan.

### Live TTY sessions

If an OMP process is currently attached to a real SSH TTY, do not try to inject keystrokes into `/dev/pts/*` or `/proc/<pid>/fd/0` unless Stefan explicitly asks for that risky low-level route. Prefer `omp --resume <session> "<message>"`; it is auditable and uses OMP’s own session mechanism.

### Background discipline

For substantial coding/review/planning runs, use `terminal(background=true, notify_on_complete=true)` from the project directory. Do not leave bounded OMP runs silently in the background.

Before launching, verify scope:

```bash
pwd
git branch --show-current 2>/dev/null || true
```

If `omp` is not on PATH, do not guess a destructive fallback. Check likely shell/profile or package-manager availability and report the blocker if it is not quickly resolvable.

## Finding Project Session Logs

## Cross-checking `.agents-local` Artifacts for Work Summaries

When Stefan asks what he did yesterday / today / in a project, especially with phrases like “generated artifacts,” “what did I discuss/plan with agents,” or “look in `.agents-local`,” do **not** stop at top-level `.agents-local` files. NILO agent artifacts are often nested under:

```text
<repo>/.agents-local/docs/artifacts/YYYY-MM-DD Day/*.md
```

Workflow:

1. Resolve the date in local time with `date` when the user says “yesterday” or “today”.
2. Search recursively, not just `maxdepth 3` or a flat file list:
   ```bash
   find /home/cx/workspace/nilo/.agents-local/docs/artifacts -type f -path "*YYYY-MM-DD*" -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort
   ```
3. Read the matching dated artifact files and summarize them as durable evidence of what Stefan discussed/planned with agents.
4. Treat artifact titles/frontmatter (`type`, `model`, `time`, `status`, `supersedes`) as first-class evidence; many artifacts are cross-agent plans/playbooks/proposals rather than code changes.
5. If a first pass misses these nested artifacts and Stefan points at the exact directory, acknowledge the miss directly and correct with the actual file list before expanding analysis.

Common dated NILO artifact themes include cross-agent comparison plans, production bug postmortems, PR-writing notes, and implementation proposals. These complement OMP logs: OMP logs show conversations/tool activity; `.agents-local/docs/artifacts` shows the durable plans and conclusions the agents wrote down.

### Encode the project path the way OMP does

Use this deterministic helper to compute the OMP session directory for a project path:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('/home/cx/workspace/nilo').resolve().as_posix()
encoded = p.replace('/', '-')
print(Path.home() / '.omp/agent/sessions' / encoded)
PY
```

Known examples:

| Project path | Session dir |
|---|---|
| `/home/cx/workspace/nilo` | `~/.omp/agent/sessions/-home-cx-workspace-nilo` may be expected by pure replacement, but observed OMP uses `~/.omp/agent/sessions/-workspace-nilo` for cwd display rooted at `/home/cx`. Prefer discovery below. |
| `/home/cx/workspace` | `~/.omp/agent/sessions/-workspace` |
| `/mnt/obsidian-vault/` | `~/.omp/agent/sessions/--mnt-obsidian-vault--` |

Because OMP’s exact path root can vary, prefer discovering by reading each session file’s first `session.cwd` field instead of relying only on directory naming.

### List latest sessions for a project without loading whole logs

```bash
python3 - <<'PY'
from pathlib import Path
import json, datetime
project = Path('/home/cx/workspace/nilo').resolve()
root = Path.home() / '.omp/agent/sessions'
rows = []
for p in root.glob('**/*.jsonl'):
    if p.name.endswith('.jsonl') and p.is_file():
        try:
            first = p.open('r', encoding='utf-8', errors='replace').readline()
            obj = json.loads(first)
        except Exception:
            continue
        if obj.get('type') != 'session':
            continue
        cwd = obj.get('cwd')
        if not cwd:
            continue
        try:
            if Path(cwd).resolve() != project:
                continue
        except Exception:
            if cwd != str(project):
                continue
        rows.append((p.stat().st_mtime, p, obj.get('timestamp'), obj.get('title'), cwd))
for mtime, p, ts, title, cwd in sorted(rows, reverse=True)[:20]:
    print(datetime.datetime.fromtimestamp(mtime).isoformat(), ts, title, p)
PY
```

Use this for “last N sessions in project” and for finding sessions by title. It reads only the first line from each JSONL file.

## Reading Only the Last Message

This is the preferred deterministic extractor. It streams the JSONL once and stores only the last matching `user`/`assistant` message. It skips reasoning/thinking and tool results by default.

```bash
python3 - <<'PY'
from pathlib import Path
import json, sys

path = Path('/absolute/path/to/session.jsonl')
wanted_roles = {'assistant'}  # use {'user', 'assistant'} if Stefan asks for either side
last = None

with path.open('r', encoding='utf-8', errors='replace') as f:
    for line_no, line in enumerate(f, 1):
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get('type') != 'message':
            continue
        msg = obj.get('message') or {}
        role = msg.get('role')
        if role not in wanted_roles:
            continue

        parts = []
        for item in msg.get('content') or []:
            typ = item.get('type')
            if typ == 'text':
                parts.append(item.get('text', ''))
            elif typ == 'toolCall':
                # Include only if the final visible answer is a tool call; otherwise skip.
                parts.append(f"[toolCall {item.get('name')} {item.get('arguments')}]")
            # deliberately skip thinking/reasoning blocks

        text = '\n'.join(part for part in parts if part).strip()
        if text:
            last = {
                'line': line_no,
                'timestamp': obj.get('timestamp'),
                'role': role,
                'text': text,
            }

if not last:
    print('NO_MATCHING_MESSAGE')
    sys.exit(1)

print(json.dumps(last, ensure_ascii=False, indent=2))
PY
```

For a concise final answer to Stefan, summarize the extracted `text`; do not dump giant text unless he asks for the exact message.

## Comparing Last Messages Across Sessions

When Stefan asks to compare final messages from two or more OMP agents:

1. Identify the project path and candidate session logs.
2. Extract the last assistant message from each log using the streaming extractor above.
3. Compare only the extracted messages, not the full logs.
4. Report:
   - shared conclusions / alignment;
   - concrete divergences;
   - unique recommendations or concerns from each agent;
   - if useful, the practical decision Stefan should take next.

Suggested response shape:

```markdown
## Alignment
- ...

## Divergence
| Topic | Agent/session A | Agent/session B |
|---|---|---|
| ... | ... | ... |

## My read
- ...
```

If one final message is only a tool call or incomplete, say that directly and optionally inspect the previous assistant text message with the same streaming approach adjusted to keep the last two messages.

## Useful One-Off Scripts

### Last assistant message from the latest N sessions in a project

```bash
python3 - <<'PY'
from pathlib import Path
import json, datetime

project = Path('/home/cx/workspace/nilo').resolve()
limit = 2
root = Path.home() / '.omp/agent/sessions'

def session_header(path):
    try:
        first = path.open('r', encoding='utf-8', errors='replace').readline()
        obj = json.loads(first)
    except Exception:
        return None
    if obj.get('type') != 'session':
        return None
    cwd = obj.get('cwd')
    if not cwd:
        return None
    try:
        if Path(cwd).resolve() != project:
            return None
    except Exception:
        if cwd != str(project):
            return None
    return obj

def last_assistant(path):
    last = None
    with path.open('r', encoding='utf-8', errors='replace') as f:
        for line_no, line in enumerate(f, 1):
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if obj.get('type') != 'message':
                continue
            msg = obj.get('message') or {}
            if msg.get('role') != 'assistant':
                continue
            parts = []
            for item in msg.get('content') or []:
                if item.get('type') == 'text':
                    parts.append(item.get('text', ''))
            text = '\n'.join(parts).strip()
            if text:
                last = (line_no, obj.get('timestamp'), text)
    return last

sessions = []
for p in root.glob('**/*.jsonl'):
    h = session_header(p)
    if h:
        sessions.append((p.stat().st_mtime, p, h))

for _, path, header in sorted(sessions, reverse=True)[:limit]:
    last = last_assistant(path)
    print('\n###', path)
    print('title:', header.get('title'))
    print('cwd:', header.get('cwd'))
    print('session_timestamp:', header.get('timestamp'))
    if not last:
        print('NO_ASSISTANT_TEXT')
        continue
    line_no, ts, text = last
    print('last_line:', line_no)
    print('last_timestamp:', ts)
    print(text[:4000])
PY
```

### Find sessions by title/content hint, but avoid loading all content into chat

Use Python to scan locally and print only paths/snippets:

```bash
python3 - <<'PY'
from pathlib import Path
import json
project = Path('/home/cx/workspace/nilo').resolve()
needle = 'review'.lower()
root = Path.home() / '.omp/agent/sessions'

for p in root.glob('**/*.jsonl'):
    try:
        first = json.loads(p.open('r', encoding='utf-8', errors='replace').readline())
    except Exception:
        continue
    if first.get('type') != 'session':
        continue
    if first.get('cwd') and Path(first['cwd']).resolve() != project:
        continue
    title = first.get('title') or ''
    matched = needle in title.lower()
    snippet = ''
    if not matched:
        with p.open('r', encoding='utf-8', errors='replace') as f:
            for line in f:
                if needle in line.lower():
                    snippet = line[:500]
                    matched = True
                    break
    if matched:
        print(title, p)
        if snippet:
            print('  snippet:', snippet.replace('\n', ' ')[:300])
PY
```

## Common Pitfalls

1. **Reading the whole JSONL into context.** Do not use `read_file` on long OMP logs when Stefan only asked for the last message. Stream and print only the extracted result.

2. **Confusing tool results with final messages.** OMP logs include `toolResult` messages. For “last message,” Stefan usually means final user/assistant text, especially final assistant answer.

3. **Including reasoning blocks.** JSONL assistant messages may contain `thinking` content. Skip it; it is not the user-visible answer and wastes context.

4. **Trusting directory names too much.** OMP session directory naming is path-derived but observed roots can vary. Confirm project matches via the first-line `session.cwd` field.

5. **Comparing full transcripts.** For review/plan comparisons, extract final answers first. Only inspect earlier context if the final answer is ambiguous or refers to unstated details.

6. **Launching OMP in the wrong directory.** Always `cd` to the intended project/worktree before starting OMP.

7. **Treating OMP completion as verification.** After an OMP edit/review run, inspect the working-tree diff yourself. OMP may make correct edits but miss small behavioral details or continue running helper processes after the useful work is done. If the git diff has changed and the process is silent for a while, it is acceptable to inspect the diff, stop the lingering run if needed, and take over verification rather than waiting indefinitely.

8. **Letting OMP drop unrelated fields during a rename.** For naming-only refactors, check that nearby control-flow/metadata fields are preserved. Compare the semantic before/after diff, not just the new names.

## Verification Checklist

- [ ] For launching: `pwd` is the intended project/worktree.
- [ ] For model-specific launch: the command includes `--model <model>` exactly as requested.
- [ ] For log lookup: candidate files match `session.cwd` for the requested project.
- [ ] For last-message extraction: used a streaming script and printed only the final relevant message.
- [ ] For comparison: compared extracted final assistant messages and separated alignment from divergence.
- [ ] For OMP-applied code changes: independently inspected `git diff`, searched for stale old names/usages, ran targeted checks, and fixed any unrelated semantic drift before reporting success.
