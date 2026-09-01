#!/usr/bin/env bash
set -euo pipefail
herdr=${HERDR_BIN_PATH:-herdr}
mode=${1:-event}
command -v jq >/dev/null || exit 0

if [ "$mode" = event ]; then
  pane_id=$(jq -r '.data.pane_id // empty' <<<"${HERDR_PLUGIN_EVENT_JSON:-null}")
  status=$(jq -r '.data.agent_status // empty' <<<"${HERDR_PLUGIN_EVENT_JSON:-null}")
  case "$status" in working|idle|done) ;; *) exit 0 ;; esac
else
  pane_id=$(jq -r '.focused_pane_id // empty' <<<"${HERDR_PLUGIN_CONTEXT_JSON:-null}")
fi
[ -n "$pane_id" ] || exit 0

agent=$("$herdr" agent get "$pane_id" 2>/dev/null) || exit 0
tab_id=$(jq -r '.result.agent.tab_id // empty' <<<"$agent")
[ -n "$tab_id" ] || exit 0
label=$("$herdr" tab get "$tab_id" | jq -r '.result.tab.label // empty')

# a non-numeric label is a name; named tabs are final (force mode overrides)
if [ "$mode" = event ] && ! [[ "$label" =~ ^[0-9]*$ ]]; then exit 0; fi

# debounce racing events, one rename in flight per tab
lock="${HERDR_PLUGIN_STATE_DIR:?}/lock-${tab_id//:/_}"
if [ -e "$lock" ] && [ $(( $(date +%s) - $(stat -c %Y "$lock") )) -lt 120 ]; then exit 0; fi
tmp=$(mktemp)
trap 'rm -f "$lock" "$tmp"' EXIT
touch "$lock"

# transcript: a reported session file is the only trusted source (scrollback of a
# fresh pane is welcome-screen chrome, e.g. other sessions' titles); scrollback
# only serves agents that report no session path at all
session=$(jq -r '.result.agent.agent_session | select(.kind == "path") | .value // empty' <<<"$agent")
if [ -n "$session" ]; then
  # a new session hits disk at its first assistant message (often the first
  # tool call, seconds in) — wait for it so the tab is named mid-turn
  deadline=$(( $(date +%s) + ${SESSION_WAIT:-90} ))
  while ! [ -s "$session" ]; do
    [ "$(date +%s)" -lt "$deadline" ] || exit 0
    sleep 1
  done
  tail -c 400000 "$session" \
    | jq -Rr -f "$HERDR_PLUGIN_ROOT/extract.jq" \
    | tail -c 8000 > "$tmp" || true
else
  "$herdr" agent read "$pane_id" --lines 200 --format text > "$tmp" 2>/dev/null || exit 0
fi
[ -s "$tmp" ] || exit 0

# greeting-sized conversations carry no task signal; skip the model call
user_chars=$( (grep '^user: ' "$tmp" || true) | sed 's/^user: //' | tr -d '[:space:]' | wc -c)
if [ "$mode" = event ] && [ "$user_chars" -lt "${MIN_USER_CHARS:-12}" ]; then exit 0; fi

# cap model calls per tab so abstaining sessions don't retry forever
attempts_file="$HERDR_PLUGIN_STATE_DIR/attempts-${tab_id//:/_}"
attempts=$(cat "$attempts_file" 2>/dev/null || echo 0)
if [ "$mode" = event ] && [ "$attempts" -ge "${MAX_ATTEMPTS:-5}" ]; then exit 0; fi
echo $((attempts + 1)) > "$attempts_file"

# hot-swappable namer: sh -c line, $PROMPT_FILE + $TRANSCRIPT_FILE in env, name on stdout
conf=${HERDR_PLUGIN_CONFIG_DIR:?}
# shellcheck disable=SC1091
[ -f "$conf/namer.env" ] && . "$conf/namer.env"
prompt_file="$conf/prompt.md"
[ -f "$prompt_file" ] || prompt_file="$HERDR_PLUGIN_ROOT/prompt.md"
default_namer='omp -p --no-session --no-extensions --no-skills --no-rules --no-tools --model @tiny "$(cat "$PROMPT_FILE")" @"$TRANSCRIPT_FILE"'

name=$(PROMPT_FILE="$prompt_file" TRANSCRIPT_FILE="$tmp" \
  timeout "${NAMER_TIMEOUT:-60}" sh -c "${NAMER_CMD:-$default_namer}" </dev/null) || exit 0

# response-first safety: first line, strip escapes/quotes, hard cap
name=$(printf '%s' "$name" \
  | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's/[[:cntrl:]]/ /g' \
  | head -n1 | tr -d '"`'"'" | sed 's/^ *//;s/ *$//' | cut -c1-48)
[ -n "$name" ] && [ "$name" != "-" ] || exit 0

"$herdr" tab rename "$tab_id" "$name"
