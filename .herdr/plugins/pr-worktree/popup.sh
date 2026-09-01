#!/usr/bin/env bash
export PATH="$HOME/.local/share/mise/shims:$HOME/.bun/bin:$PATH"
command -v bun >/dev/null || { printf 'pr-worktree: bun is not installed\nPress Enter to close…' >&2; read -r; exit 1; }
# Errors must survive the popup closing; bin/prw leaves them in the scrollback.
export PRWT_POPUP=1
exec bun src/main.ts
