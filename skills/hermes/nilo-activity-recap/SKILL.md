---
name: nilo-activity-recap
description: Use when Stefan asks what he did on a prior day in NILO, including commits, OMP/session logs, dirty worktrees, and .agents-local durable artifacts. Produces concise evidence-based recaps without bloating the main context.
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [nilo, activity-recap, omp, artifacts, git, worktrees]
    related_skills: [omp-oh-my-pi-sessions, nilo-worktree-setup]
---

# NILO Activity Recap

## Overview

Use this skill when Stefan asks things like:

- “What did I do yesterday?”
- “What did I look into / discuss / plan with agents?”
- “Summarize what happened last Friday in NILO.”
- “Check commits, OMP logs, .agents-local artifacts, etc.”

The goal is a concise, evidence-based recap across four evidence classes:

1. Git commits and worktree state.
2. OMP / Oh My Pi session logs.
3. `.agents-local` durable artifacts and notes.
4. Dirty/uncommitted work.

Important: OMP logs are large. **Always delegate OMP/session-log browsing to a subagent** so the main context receives only a filtered summary.

## Default Scope

Unless Stefan says otherwise:

- Scope is NILO under `/home/cx/workspace/nilo*` and `/home/cx/workspace/nilo-worktrees/*`.
- Use the live system timezone.
- If he says “yesterday,” compute it with `date`; do not infer mentally.
- Include all NILO clones/worktrees, but deduplicate commits by SHA.
- Prioritize Stefan-related author names:
  - `Stefan`
  - `Stefan Ginev`
  - `Cursor Agent`
- Treat teammate/remote commits as context only, not as “Stefan did this,” unless other evidence links them to Stefan.

## Workflow

### 1. Establish the target date

Always ground date arithmetic in the system clock:

```bash
date --iso-8601=seconds
date -d yesterday +%F
```

For a named day/date, normalize to `YYYY-MM-DD` and state it in the final recap.

### 2. Scan git commits and worktree state

Scan all relevant repos/worktrees. Deduplicate by full SHA and keep repo/worktree paths as evidence.

Useful one-liner/script:

```bash
python3 - <<'PY'
from pathlib import Path
import subprocess, collections, sys

TARGET_DATE = 'YYYY-MM-DD'  # replace before running
AUTHOR_HINTS = ('Stefan', 'Cursor Agent')

candidates = []
base = Path('/home/cx/workspace')
candidates += [p for p in base.glob('nilo*') if p.is_dir()]
wt = base / 'nilo-worktrees'
if wt.is_dir():
    candidates += [p for p in wt.iterdir() if p.is_dir()]

repos = []
for p in candidates:
    try:
        r = subprocess.run(['git', '-C', str(p), 'rev-parse', '--show-toplevel'], capture_output=True, text=True, timeout=5)
    except Exception:
        continue
    if r.returncode == 0:
        repos.append(Path(r.stdout.strip()))
repos = sorted(set(repos))

rows = {}
repo_for = collections.defaultdict(list)
for repo in repos:
    out = subprocess.run([
        'git', '-C', str(repo), 'log', '--all',
        '--since', TARGET_DATE + ' 00:00',
        '--until', TARGET_DATE + ' 23:59:59',
        '--date=iso-local',
        '--pretty=format:%H%x09%h%x09%ad%x09%an%x09%D%x09%s',
    ], capture_output=True, text=True, timeout=30).stdout
    for line in out.splitlines():
        parts = line.split('\t', 5)
        if len(parts) < 6:
            continue
        H, h, ad, an, refs, subject = parts
        if not any(hint.lower() in an.lower() for hint in AUTHOR_HINTS):
            continue
        if H not in rows:
            files = subprocess.run(['git', '-C', str(repo), 'show', '--format=', '--name-only', H], capture_output=True, text=True, timeout=10).stdout.strip().splitlines()
            rows[H] = (h, ad, an, refs, subject, files)
        repo_for[H].append(str(repo))

print(f'unique Stefan/Cursor commits on {TARGET_DATE}: {len(rows)}')
for H, (h, ad, an, refs, subject, files) in sorted(rows.items(), key=lambda kv: kv[1][1]):
    refs_text = f' {refs}' if refs else ''
    print(f'{ad} {h} {an}{refs_text}')
    print(f'  {subject}')
    print('  repos: ' + ', '.join(sorted(set(repo_for[H]))))
    print('  files: ' + ('; '.join(files[:12]) if files else '(merge/no file list)'))
PY
```

Also list current branch/dirty state:

```bash
python3 - <<'PY'
from pathlib import Path
import subprocess

candidates = []
base = Path('/home/cx/workspace')
candidates += [p for p in base.glob('nilo*') if p.is_dir()]
wt = base / 'nilo-worktrees'
if wt.is_dir():
    candidates += [p for p in wt.iterdir() if p.is_dir()]

repos = []
for p in candidates:
    r = subprocess.run(['git', '-C', str(p), 'rev-parse', '--show-toplevel'], capture_output=True, text=True, timeout=5)
    if r.returncode == 0:
        repos.append(Path(r.stdout.strip()))

for repo in sorted(set(repos)):
    branch = subprocess.run(['git', '-C', str(repo), 'branch', '--show-current'], capture_output=True, text=True, timeout=5).stdout.strip()
    head = subprocess.run(['git', '-C', str(repo), 'log', '-1', '--date=iso-local', '--pretty=format:%h %ad %an %s'], capture_output=True, text=True, timeout=5).stdout.strip()
    status = subprocess.run(['git', '-C', str(repo), 'status', '--short'], capture_output=True, text=True, timeout=5).stdout.strip()
    print(f'{repo}\n  branch={branch or "(detached)"}\n  HEAD={head}\n  dirty={"yes" if status else "no"}')
    if status:
        print('\n'.join('    ' + line for line in status.splitlines()[:20]))
PY
```

### 3. Delegate OMP/session-log scanning

**Hard rule:** Do not load raw OMP JSONL logs into the main context. Spawn a small subagent with `terminal` and `file` tools.

Subagent prompt template:

```text
User asked for a NILO activity recap for TARGET_DATE.

Browse OMP / Oh My Pi session logs under ~/.omp/agent/sessions/**/*.jsonl.
Match sessions whose first-line session.cwd starts with /home/cx/workspace/nilo, including /home/cx/workspace/nilo-worktrees/*.
Filter to TARGET_DATE using the session timestamp and message timestamps.
Do not dump full logs.
Return concise evidence only:
- session title
- cwd
- log path
- local time range if inferable
- final visible assistant summary
- tests run
- commits/PRs mentioned
- dirty-work hints
- notable decisions or plans
Mention empty/no-op sessions only if relevant.
```

What to expect from the subagent:

- A short list of OMP sessions grouped by topic.
- Commit/test/PR evidence found inside final assistant messages or tool outputs.
- Caveats about overlapping sessions or incomplete logs.

### 4. Inspect `.agents-local` artifacts yourself

Always check the nested durable-artifact directory first:

```text
/home/cx/workspace/nilo/.agents-local/docs/artifacts/<YYYY-MM-DD Day>/
```

Example for Wednesday 2026-06-17:

```bash
find '/home/cx/workspace/nilo/.agents-local/docs/artifacts/2026-06-17 Wednesday' -maxdepth 1 -type f -printf '%f\n' | sort
```

If you need the day name:

```bash
date -d YYYY-MM-DD '+%Y-%m-%d %A'
```

Read each artifact’s frontmatter and heading. Summarize by:

- exact filename;
- `type`;
- `model`;
- `time`;
- title/topic;
- exact final recommendation / decision / rule.

Do not stop at top-level `.agents-local`. The important files may be under `docs/artifacts/<date day>/`.

Also inspect nearby `.agents-local` files if they are date-relevant or topic-relevant:

```bash
find /home/cx/workspace/nilo/.agents-local -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort -r | head -80
```

### 5. Synthesize by evidence class

Separate the final recap into evidence classes:

1. **Committed work** — commits with SHAs, subjects, files/themes.
2. **OMP implementation/debug sessions** — from subagent summary only.
3. **Agent planning/artifacts** — exact `.agents-local/docs/artifacts` filenames and decisions.
4. **Dirty/uncommitted work** — current dirty worktrees and changed files.
5. **Weaker evidence** — agent-authored commits or ambiguous sessions that may be Stefan’s agent runs.

Use precise language:

- “The artifact says…”
- “Final consensus was…”
- “Commit `abc123` changed…”
- “OMP session `Title` ended with…”

Avoid vague language:

- “seems like some work around…”
- “maybe explored…”
- “various things related to…”

If evidence is ambiguous, say exactly why:

- “This is weaker evidence because the author is `Cursor Agent`, not Stefan.”
- “This session is discussion-only; no commit/test evidence was found.”

## Output Templates

### Brief answer

```markdown
Yesterday = YYYY-MM-DD local time.

You mainly did:

1. **Topic A**
   - Evidence: commit `abc123` / OMP session `Title` / artifact `filename.md`.
   - Exact outcome: ...

2. **Topic B**
   - Evidence: ...
   - Exact outcome: ...

3. **Topic C**
   - Evidence: ...
   - Exact outcome: ...

Dirty/uncommitted:
- `/path`: changed files ...

Caveat:
- ...
```

### Artifact-focused brief answer

```markdown
`/.agents-local/docs/artifacts/YYYY-MM-DD Day` contains N artifacts:

| Time | File | Type/model | Exact topic |
|---:|---|---|---|
| HH:MM | `file.md` | Plan — GPT-5.5 | ... |

Exact summary:
1. **Topic** — final recommendation was: “...”
2. **Topic** — the artifact says: “...”
```

### “Briefly, exact wording” answer

When Stefan asks for brevity and exact wording, answer in 3–7 bullets:

```markdown
1. **Prod blank-screen crash**
   - Error: `Cannot access 'P' before initialization` at `RoomMode.ts:9:13`.
   - Cause: `RoomMode` / `ClientMode` were re-exported through `@/core/client`, dragging eager TypeScript enum initialization into the large cyclic `Client` graph.
   - Fix: keep `src/core/client/index.ts` exporting only `Client`; import `RoomMode` and `ClientMode` directly.
```

Do not include process narration unless asked.

## Common Pitfalls

1. **Missing `.agents-local/docs/artifacts`.** Top-level `.agents-local` may look empty/stale while the real artifacts are under `docs/artifacts/<date day>/`.

2. **Reading raw OMP logs into main context.** Always delegate OMP/session-log scanning to a subagent.

3. **Over-reporting teammate commits.** Git history across NILO includes many remote/team commits. Filter and label evidence.

4. **Counting the same commit once per clone.** Deduplicate by full SHA.

5. **Using vague synthesis.** Stefan often wants exact wording. Quote filenames, commit SHAs, error messages, artifact conclusions, and decision language.

6. **Treating agent-authored commits as definitely Stefan-authored.** Label them as weaker evidence unless OMP/session/artifact context links them to Stefan.

7. **Skipping dirty worktrees.** Current dirty state often reveals unfinished work that did not make it into commits or OMP summaries.

## Verification Checklist

- [ ] Target date established with `date` or explicit user date.
- [ ] Git scan covered `/home/cx/workspace/nilo*` and `/home/cx/workspace/nilo-worktrees/*`.
- [ ] Commits deduplicated by full SHA.
- [ ] OMP/session logs delegated to a subagent; raw logs not loaded into main context.
- [ ] `.agents-local/docs/artifacts/<YYYY-MM-DD Day>/` inspected directly.
- [ ] Dirty worktrees checked.
- [ ] Final answer separates committed work, OMP sessions, artifacts/plans, and dirty work.
- [ ] Ambiguous evidence is labeled rather than overstated.
- [ ] Answer is concise when Stefan asks for brevity.
