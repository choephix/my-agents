#!/usr/bin/env bash
set -euo pipefail

herdr=${HERDR_BIN_PATH:-herdr}

fail() {
  "$herdr" notification show "OMP fork failed" --body "$1" --sound none >/dev/null 2>&1 || true
  printf 'omp-fork-pane: %s\n' "$1" >&2
  exit 1
}

command -v jq >/dev/null || fail 'jq is not installed'

context=${HERDR_PLUGIN_CONTEXT_JSON:-null}
pane_id=$(jq -r '.focused_pane_id // empty' <<<"$context") ||
  fail 'Herdr provided invalid plugin context'
workspace_id=$(jq -r '.workspace_id // empty' <<<"$context") ||
  fail 'Herdr provided invalid plugin context'
pane_id=${pane_id:-${HERDR_PANE_ID:-}}
workspace_id=${workspace_id:-${HERDR_WORKSPACE_ID:-}}
[[ -n $pane_id ]] || fail 'no focused pane in the invocation context'

source=$("$herdr" pane get "$pane_id") || fail "could not inspect pane $pane_id"
agent=$(jq -r '.result.pane.agent // empty' <<<"$source") || fail 'could not read the pane agent'
session_path=$(jq -r '.result.pane.agent_session.value // empty' <<<"$source") ||
  fail 'could not read the pane session'
cwd=$(jq -r '.result.pane.foreground_cwd // .result.pane.cwd // empty' <<<"$source") ||
  fail 'could not read the pane working directory'

[[ $agent == omp ]] || fail "pane $pane_id is not running OMP (detected: ${agent:-none})"
[[ -n $session_path ]] || fail "pane $pane_id has no reported OMP session"

session_file=${session_path##*/}
session_stem=${session_file%.jsonl}
session_id=${session_stem##*_}
[[ $session_id =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] ||
  fail "could not extract an OMP session ID from $session_path"

# Sessions are stored per omp profile; the forked pane is spawned by the herdr
# server (no interactive shell, so ~/.bashrc's profile wrapper never runs).
# Without OMP_PROFILE the fork resolves against the default profile and dies
# with `Session "<id>" not found.`
profile=
case $session_path in
  */.omp/profiles/*/agent/sessions/*)
    profile=${session_path#*/.omp/profiles/}
    profile=${profile%%/*}
    ;;
esac

open_args=(
  plugin pane open
  --plugin "$HERDR_PLUGIN_ID"
  --entrypoint forked-omp
  --cwd "${cwd:-$HOME}"
  --env "OMP_FORK_SESSION_ID=$session_id"
  --focus
)

if [[ -n $profile ]]; then
  open_args+=(--env "OMP_PROFILE=$profile")
fi

# A second argument is typed into the fork at startup — OMP executes argv
# messages, slash commands included, so "/prose" distills with no TUI games.
if [[ -n ${2:-} ]]; then
  open_args+=(--env "OMP_FORK_PROMPT=$2")
fi

case ${1:-split} in
  split)
    open_args+=(--placement split --target-pane "$pane_id" --direction right)
    ;;
  tab)
    [[ -n $workspace_id ]] || fail 'no workspace in the invocation context'
    open_args+=(--placement tab --workspace "$workspace_id")
    ;;
  *)
    fail "unknown placement: $1"
    ;;
esac

"$herdr" "${open_args[@]}" >/dev/null
