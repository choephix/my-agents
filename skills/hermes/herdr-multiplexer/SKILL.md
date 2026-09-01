---
name: herdr-multiplexer
description: Use when you need to interact with `herdr` (pronounced like "herder")
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags:
      - herdr
      - terminal
      - panes
    related_skills: []
---
# Herdr

Stefan does most manual work using `herdr`. It's a `tmux` wrapper with workspaces, tabs and panes.

## First-class worktrees

A Herdr-managed worktree is a workspace with Git worktree provenance and a parent workspace relationship. Herdr displays it beneath the parent repository workspace in the sidebar.

When the user wants a worktree spawned from a Herdr workspace, use Herdr's worktree API rather than manually combining `git worktree add` with `herdr workspace create`:

```bash
herdr worktree create \
  --workspace <parent_workspace_id> \
  --branch <branch> \
  --base <base_ref> \
  --label '<short-label>' \
  --focus \
  --json
```

If the checkout already exists, attach it through the worktree API:

```bash
herdr worktree open \
  --workspace <parent_workspace_id> \
  --path <checkout_path> \
  --focus \
  --json
```

Do not represent a requested worktree as a tab with a different cwd, and do not create an unrelated workspace rooted at a manually-created checkout.

If asked to interact with it beyond what this guide covers, read https://herdr.dev/docs/cli-reference/.

## Naming workspaces and tabs

- **Workspace**: leave the label default (the cwd). Name it only when it's expected to operate across different folders inside — then choose a fitting name.
- **Tab**: shorter is better, uniquely descriptive — the label carries only what tells this tab apart from the others in its workspace.

## Clear all safe panes

```bash
python3 - <<'PY'
import json, subprocess

AGENT_NAMES = {
    'claude', 'codex', 'gemini', 'opencode', 'omp', 'cursor-agent',
    'node', 'bun', 'python', 'python3',
}

def run(*args):
    return subprocess.run(args, text=True, capture_output=True, check=True).stdout

panes = json.loads(run('herdr', 'pane', 'list'))['result']['panes']
cleared = skipped = 0

for pane in panes:
    pane_id = pane['pane_id']
    info = json.loads(run('herdr', 'pane', 'process-info', '--pane', pane_id))['result']['process_info']
    names = {p.get('name') for p in info.get('foreground_processes', [])}

    if pane.get('agent_status') not in (None, 'unknown', 'idle') or names & AGENT_NAMES:
        skipped += 1
        continue

    subprocess.run(['herdr', 'pane', 'send-keys', pane_id, 'ctrl+l'], check=False)
    cleared += 1

print(f'cleared={cleared} skipped={skipped} total={len(panes)}')
PY
```

If the user explicitly wants every pane regardless of agent state, skip the guard and run `herdr pane send-keys <pane_id> ctrl+l` for each pane from `herdr pane list`.
