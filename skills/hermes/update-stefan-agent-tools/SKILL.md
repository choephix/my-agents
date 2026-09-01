---
name: update-stefan-agent-tools
description: "Use when Stefan asks to update his local AI-agent toolchain: Hermes, Herdr, OMP, OpenCode, Claude Code, Cursor Agent, or OpenAI Codex. Checks live install method first, updates carefully, and verifies versions."
version: 1.0.0
author: Rhinox
license: MIT
metadata:
  hermes:
    tags: [updates, agent-tools, hermes, herdr, omp, opencode, claude-code, cursor-agent, codex]
    related_skills: [hermes-agent]
---

# Update Stefan's Agent Tools

## Overview

Use this for Stefan's recurring "update my shit" task: update local AI coding agents and their integrations without guessing install methods or breaking running sessions.

Target tools:

- Hermes Agent (`hermes`)
- Herdr (`herdr`)
- OMP / Oh My Pi (`omp`)
- OpenCode (`opencode`)
- Claude Code / CC (`claude`)
- Cursor Agent (`cursor-agent`, sometimes exposed as `agent` in docs)
- OpenAI Codex (`codex`)

This is Stefan's real development server, not a sandbox. Prefer discover → update → verify. If a tool is missing or installed through an unexpected path, report that instead of forcing a random installer.

## When to Use

- Stefan says "update Hermes", "update Herdr", "update omp", "update agents", "update my shit", or names one of the tools above.
- After updating Herdr, when integrations need refreshing.
- When checking whether the toolchain is stale.

Do **not** use for project dependency updates (`pnpm update`, app packages, NILO deps) unless Stefan explicitly asks for those.

## First: Discovery Snapshot

Always capture command locations and versions before changing anything:

```bash
set -e
printf '== command locations ==\n'
for c in hermes herdr omp opencode claude cursor-agent cursor codex npm bun mise uvx uv; do
  printf '%-14s ' "$c"; command -v "$c" || true
done

printf '\n== versions ==\n'
for c in hermes herdr omp opencode claude cursor-agent codex; do
  if command -v "$c" >/dev/null 2>&1; then
    echo "--- $c ---"
    "$c" --version 2>&1 | head -20 || true
  fi
done
```

Important local facts observed on Axalon:

- `hermes` lives at `/home/cx/.local/bin/hermes` and supports `hermes update`.
- `herdr` lives at `/home/cx/.local/bin/herdr` and supports `herdr update`.
- `claude` lives at `/home/cx/.local/bin/claude`, symlinked into `~/.local/share/claude/versions/<version>`.
- `cursor-agent` lives at `/home/cx/.local/bin/cursor-agent`, symlinked into `~/.local/share/cursor-agent/versions/<version>/cursor-agent`.
- `codex` may be installed globally through npm under the active nvm Node, e.g. `@openai/codex`.
- `omp` is installed at `/home/cx/.bun/bin/omp` and requires Bun/mise on PATH.

OMP PATH fix if `omp` or `bun` is missing:

```bash
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/share/mise/installs/bun/1.3.14/bin:$HOME/.bun/bin:$PATH"
```

## Update Commands by Tool

### Hermes Agent

Load the `hermes-agent` skill first when troubleshooting Hermes itself.

Normal update:

```bash
hermes update
hermes --version
hermes doctor || true
hermes config check || true
```

If the gateway is running and the update changed runtime code, restart it after the update:

```bash
hermes gateway status || true
hermes gateway restart || true
```

If config migration is requested or missing config is reported:

```bash
hermes config check
hermes config migrate
```

### Herdr

Check status before updating because a running server can block replacement:

```bash
herdr --version
herdr status || true
herdr update
```

If Herdr says it was not updated because sessions are running, ask Stefan before stopping unless he already gave permission. Once allowed:

```bash
herdr server stop || true
herdr update
herdr --version
herdr status || true
```

After Herdr updates, check integrations:

```bash
herdr integration status
```

If any installed integration is outdated, refresh only those that are installed/outdated, for example:

```bash
herdr integration install claude
herdr integration install codex
herdr integration install omp
herdr integration install opencode
```

Then verify again:

```bash
herdr integration status
```

### OMP / Oh My Pi

First make sure Bun/mise is on PATH:

```bash
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/share/mise/installs/bun/1.3.14/bin:$HOME/.bun/bin:$PATH"
command -v bun && bun --version
command -v omp && omp --version
```

Observed install path is Bun global package `@oh-my-pi/pi-coding-agent`:

```bash
bun add -g @oh-my-pi/pi-coding-agent@latest
omp --version
```

If that package is not present but an older/forked package is installed via npm, inspect first:

```bash
npm list -g --depth=0 | grep -E 'pi-coding-agent|oh-my-pi|earendil' || true
npm view @oh-my-pi/pi-coding-agent version
npm view @earendil-works/pi-coding-agent version || true
```

Do not replace package families silently. If the active `omp` binary resolves to `@oh-my-pi/pi-coding-agent`, update that package. If it resolves to another package, report and ask.

### OpenCode

First discover install method:

```bash
command -v opencode || true
opencode --version 2>&1 | head -20 || true
npm list -g --depth=0 | grep -i opencode || true
npm view opencode-ai version || true
```

If installed via npm package `opencode-ai`:

```bash
npm install -g opencode-ai@latest
opencode --version
```

If installed via Homebrew/mise/curl/binary instead, do not guess; use the detected package manager's upgrade path or report the mismatch.

### Claude Code / CC

Claude Code currently exposes `claude`.

Check install path/version:

```bash
command -v claude
readlink -f "$(command -v claude)" || true
claude --version
```

Current local layout may use Claude's own versioned installer under `~/.local/share/claude/versions/`. Prefer the built-in updater if present:

```bash
claude update || true
claude --version
```

If the built-in updater is unavailable and npm was the install method, update npm package:

```bash
npm install -g @anthropic-ai/claude-code@latest
claude --version
```

If Homebrew was the install method, use:

```bash
brew upgrade claude-code || brew upgrade claude-code@latest
claude --version
```

Do not blindly npm-install over a non-npm Claude install unless Stefan asks.

### Cursor Agent

Cursor Agent supports its own update command.

```bash
command -v cursor-agent
cursor-agent --version
cursor-agent update
cursor-agent --version
```

Docs may refer to the command as `agent`; on this machine the binary is `cursor-agent`.

If `cursor-agent update` fails, use the official installer only after checking the current path:

```bash
curl https://cursor.com/install -fsS | bash
cursor-agent --version
```

Avoid touching the desktop `cursor` binary unless Stefan explicitly asks.

### OpenAI Codex

Check current install:

```bash
command -v codex || true
codex --version 2>&1 | head -20 || true
npm list -g --depth=0 @openai/codex || true
npm view @openai/codex version
```

If installed globally via npm:

```bash
npm install -g @openai/codex@latest
codex --version
```

If `codex` is missing from PATH but npm global has it, check nvm Node bin path:

```bash
npm bin -g 2>/dev/null || dirname "$(npm root -g)"/bin
```

## Bulk Update Recipe

Run discovery first, then update in this order:

1. Hermes (`hermes update`) — may affect this agent/gateway; be ready to restart gateway.
2. Herdr (`herdr update`) — may require stopping running Herdr server.
3. Package-manager CLIs: OMP, OpenCode, Claude Code, Cursor Agent, Codex.
4. Herdr integrations (`herdr integration status`, refresh outdated installed integrations).
5. Final version report.

Conservative bulk command skeleton:

```bash
set -euo pipefail
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/share/mise/installs/bun/1.3.14/bin:$HOME/.bun/bin:$PATH"

hermes update
hermes --version

herdr update || true
# If blocked and Stefan has allowed stopping:
# herdr server stop || true
# herdr update
herdr --version

if command -v omp >/dev/null 2>&1; then
  bun add -g @oh-my-pi/pi-coding-agent@latest
  omp --version
fi

if command -v opencode >/dev/null 2>&1 && npm list -g --depth=0 opencode-ai >/dev/null 2>&1; then
  npm install -g opencode-ai@latest
  opencode --version
fi

if command -v claude >/dev/null 2>&1; then
  claude update || npm install -g @anthropic-ai/claude-code@latest
  claude --version
fi

if command -v cursor-agent >/dev/null 2>&1; then
  cursor-agent update
  cursor-agent --version
fi

if command -v codex >/dev/null 2>&1 && npm list -g --depth=0 @openai/codex >/dev/null 2>&1; then
  npm install -g @openai/codex@latest
  codex --version
fi

herdr integration status || true
```

Adjust after discovery; this skeleton intentionally avoids installing tools that are not already present.

## Verification Checklist

- [ ] Show before/after versions for every requested tool.
- [ ] Confirm `command -v <tool>` still resolves to the intended path.
- [ ] For Herdr, confirm `herdr status` and `herdr integration status`.
- [ ] For Hermes, run `hermes doctor` or `hermes config check` if the update mentions config changes.
- [ ] If gateway was restarted, confirm `hermes gateway status`.
- [ ] If a command failed due to install method mismatch, say exactly which command/path caused the block.

## Common Pitfalls

1. **Updating Herdr while the server is running.** `herdr update` may download but refuse to install. Stop only with Stefan's permission, because panes/agents can be affected.

2. **Missing OMP because PATH lacks Bun/mise.** Add `$HOME/.local/share/mise/shims`, the Bun install dir, and `$HOME/.bun/bin` before concluding OMP is absent.

3. **Replacing install methods accidentally.** If a tool was installed with a native installer/versioned symlink, do not overwrite it with npm just because an npm package exists. Discover first.

4. **Assuming docs match local binary names.** Cursor docs may say `agent`; use `cursor-agent` on this machine unless discovery shows otherwise.

5. **Forgetting Herdr integrations after agent updates.** Updating Herdr or agents can leave hooks stale. Always run `herdr integration status` and refresh outdated installed integrations.

6. **Stopping after an install command without verification.** Always run the binary and show its version after updating.
