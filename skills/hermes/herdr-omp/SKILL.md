---
name: herdr-omp
description: Use when Stefan asks to start a coding agent/OMP for a branch or project. Defaults to Herdr + normal OMP TUI, reusing an existing branch workspace when possible.
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [herdr, omp, coding-agent, branch-workspace]
    related_skills: [herdr-multiplexer, omp-oh-my-pi-sessions]
---

# Herdr + OMP

## Default

When Stefan asks to start a coding agent, default to **OMP inside Herdr**, using the normal TUI.

Preferred launch in the selected pane/workspace:

```bash
export PATH="/home/cx/.local/share/mise/shims:/home/cx/.local/share/mise/installs/bun/1.3.14/bin:/home/cx/.bun/bin:$PATH"
omp --auto-approve "<prompt>"
```

Do not specify `--model` by default. 
Do **not** use `--mode json`.

If Stefan names a model, resolve his shorthand to the real OMP model slug from `~/.omp/agent/config.yml` `modelRoles`, then pass `--model <slug>`.

Current favorite shorthand map:

| Stefan says       | OMP model slug                        |
| ----------------- | ------------------------------------- |
| GPT high, GPT     | `openai-codex/gpt-5.5:xhigh`          |
| GPT low, fast GPT | `openai-codex/gpt-5.5:low`            |
| Opus, Claude      | `anthropic/claude-opus-4-8:xhigh` if Anthropic auth is configured; otherwise `cursor/claude-opus-4-8:xhigh` works as the fallback |
| Kimi              | `kimi-code/kimi-for-coding:high`      |
| Gemini            | `google-antigravity/gemini-3.5-flash` |
| Gemini Pro        | `google-antigravity/gemini-3.1-pro`   |
| Composer          | `cursor/composer-2.5-fast`            |

Example:
```bash
omp --auto-approve --model openai-codex/gpt-5.5:xhigh "<prompt>"
```

## If a Branch Is Mentioned

First find an existing checkout for that branch, then reuse it if already open in Herdr.

```bash
BRANCH='stefan/example-branch' python3 - <<'PY'
import json, os, pathlib, subprocess, sys
branch = os.environ['BRANCH']
roots = [pathlib.Path('/home/cx/workspace'), pathlib.Path('/home/cx/workspace/nilo-worktrees')]
matches = []
for root in roots:
    for p in root.glob('*'):
        if not (p/'.git').exists() and not (p/'.git').is_file():
            continue
        r = subprocess.run(['git','-C',str(p),'branch','--show-current'], text=True, capture_output=True)
        if r.stdout.strip() == branch:
            matches.append(str(p.resolve()))
panes = json.loads(subprocess.check_output(['herdr','pane','list'], text=True))['result']['panes']
open_cwds = {str(pathlib.Path(x.get('cwd','')).resolve()) for x in panes if x.get('cwd')}
for m in matches:
    print(('OPEN ' if m in open_cwds else 'FOUND ') + m)
if not matches:
    sys.exit('NO_MATCH')
PY
```

- `OPEN <path>`: focus/reuse that Herdr workspace/pane.
- `FOUND <path>`: create/focus a new Herdr workspace there:
  ```bash
  herdr workspace create --cwd <path> --focus
  ```
  Leave the workspace label default (cwd); name it only if it will operate across different folders inside (see herdr-multiplexer naming rules).
- `NO_MATCH` for a NILO branch: create the worktree with:
  ```bash
  cd /home/cx/workspace && ./create-nilo-worktree.sh <branch>
  ```
  It goes under `/home/cx/workspace/nilo-worktrees/<branch-with-/-as-__>/`, then create/focus a Herdr workspace there.
- `NO_MATCH` outside NILO: ask where to work.

## Starting in Herdr

1. Pick/focus the target workspace/pane.
2. Verify visible scope before launching:
   ```bash
   pwd; git branch --show-current; git status --short
   ```
3. Inspect `herdr pane process-info --pane <pane_id>` before using `pane run`.
   - If the pane is at a shell, start OMP with `herdr pane run <pane_id> '<command>'`.
   - If OMP is already the foreground process, **do not use `pane run`**: Herdr can deliver the supposed shell command into the OMP prompt, causing OMP to interpret or recursively launch it. Continue that session with `pane send-text` followed by a separate `pane send-keys ... enter`, or deliberately stop OMP and verify the shell is back before running a new command.
4. Keep the prompt concise and task-specific. If using another skill (e.g. merge-main), include only its operative rules.
