#!/usr/bin/env bash
set -euo pipefail

herdr=${HERDR_BIN_PATH:-herdr}

fail() {
  "$herdr" notification show "PR worktree failed" --body "$1" --sound none >/dev/null 2>&1 || true
  printf 'pr-worktree: %s\n' "$1" >&2
  exit 1
}

command -v jq >/dev/null || fail 'jq is not installed'

context=${HERDR_PLUGIN_CONTEXT_JSON:-null}
pane_id=$(jq -r '.focused_pane_id // empty' <<<"$context") ||
  fail 'Herdr provided invalid plugin context'
cwd=$(jq -r '.focused_pane_cwd // empty' <<<"$context") ||
  fail 'Herdr provided invalid plugin context'
workspace_id=$(jq -r '.workspace_id // empty' <<<"$context") ||
  fail 'Herdr provided invalid plugin context'
pane_id=${pane_id:-${HERDR_PANE_ID:-}}
workspace_id=${workspace_id:-${HERDR_WORKSPACE_ID:-}}

"$herdr" plugin pane open \
  --plugin "$HERDR_PLUGIN_ID" \
  --entrypoint popup \
  --placement popup \
  --width 70% \
  --height 60% \
  --env "PRWT_SOURCE_PANE_ID=$pane_id" \
  --env "PRWT_SOURCE_CWD=$cwd" \
  --env "PRWT_SOURCE_WORKSPACE_ID=$workspace_id" \
  --focus >/dev/null
