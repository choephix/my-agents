#!/usr/bin/env bash
set -euo pipefail

herdr=${HERDR_BIN_PATH:-herdr}
command -v jq >/dev/null || exit 0

is_agent() {
  case "$1" in
    omp|pi|claude|codex|gemini|cursor|opencode|kimi|hermes|grok|copilot|devin|droid|amp|kilo|qodercli|maki) return 0 ;;
    *) return 1 ;;
  esac
}

basename_token() {
  local token=${1%/}
  printf '%s' "${token##*/}"
}

positional_words() {
  local out= arg word
  for arg in "$@"; do
    case "$arg" in -*) continue ;; esac
    word=$(basename_token "$arg")
    [ -n "$word" ] || continue
    out="${out:+$out }$word"
  done
  printf '%s' "$out"
}

package_task() {
  local arg
  for arg in "$@"; do
    case "$arg" in run|-*) ;; *) basename_token "$arg"; return ;; esac
  done
}

runtime_candidate() {
  local arg
  while [ "$#" -gt 0 ]; do
    arg=$1
    shift
    case "$arg" in
      -c|-e|--eval|--print) return ;;
      -*) ;;
      *) candidate "$arg" "$@"; return ;;
    esac
  done
}

transparent_candidate() {
  local arg skip=false
  while [ "$#" -gt 0 ]; do
    arg=$1
    shift
    if $skip; then skip=false; continue; fi
    case "$arg" in
      -u|-g|-h|-p|-C|-T|-R|-D|--user|--group|--host|--prompt|--chdir) skip=true ;;
      run|exec|--|-*) ;;
      *=*) ;;
      *) candidate "$arg" "$@"; return ;;
    esac
  done
}

deno_candidate() {
  local -a words=()
  local arg
  for arg in "$@"; do
    case "$arg" in -*) ;; *) words+=("$(basename_token "$arg")") ;; esac
  done
  case "${words[0]:-}" in
    task) printf 'deno%s' "${words[1]:+ ${words[1]}}" ;;
    run) [ "${#words[@]}" -gt 1 ] && candidate "${words[1]}" "${words[@]:2}" || printf deno ;;
    *) positional_words deno "$@" ;;
  esac
}

ssh_host() {
  local skip=false arg
  for arg in "$@"; do
    if $skip; then skip=false; continue; fi
    case "$arg" in
      -[46AaCfGgKkMNnqsTtVvXxYy]) ;;
      -[BbCcDEeFIiJLlmOoPpQRSWw]) skip=true ;;
      -*) ;;
      *) printf '%s' "${arg##*@}"; return ;;
    esac
  done
}

candidate() {
  local exe=${1:-} sub target
  exe=${exe##*/}
  shift || true

  case "$exe" in
    npm-cli.js|npm-cli.cjs) exe=npm ;;
    pnpm.js|pnpm.cjs) exe=pnpm ;;
    yarn.js|yarn.cjs) exe=yarn ;;
  esac

  case "$exe" in ''|bash|zsh|fish|sh|dash) return ;; esac
  is_agent "$exe" && return

  case "$exe" in
    npm|pnpm|yarn|bun)
      sub=$(package_task "$@")
      printf '%s' "$exe${sub:+ $sub}"
      ;;
    node|python|python3|ruby|perl|java|julia|tsx|ts-node)
      target=$(runtime_candidate "$@")
      printf '%s' "${target:-$exe}"
      ;;
    deno) deno_candidate "$@" ;;
    sudo|env|corepack|uv|poetry|pipx|mise)
      target=$(transparent_candidate "$@")
      printf '%s' "${target:-$exe}"
      ;;
    ssh|mosh)
      target=$(ssh_host "$@")
      printf '%s' "$exe${target:+ $target}"
      ;;
    go)
      if [ "${1:-}" = run ]; then
        shift
        target=$(runtime_candidate "$@")
        printf '%s' "${target:-go run}"
      else
        positional_words "$exe" "$@"
      fi
      ;;
    cargo|make|just|docker|podman)
      sub=${1:-}
      printf '%s' "$exe${sub:+ $sub}"
      ;;
    *) positional_words "$exe" "$@" ;;
  esac
}

if [ "${1:-}" = --name ]; then
  shift
  candidate "$@"
  exit
fi

state=${HERDR_PLUGIN_STATE_DIR:?}
owned_file="$state/proc-owned.tsv"
lock_dir="$state/proc-sweep.lock"
stamp="$state/proc-sweep.stamp"

mkdir "$lock_dir" 2>/dev/null || exit 0
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

now=$(date +%s)
if [ -e "$stamp" ] && [ $((now - $(stat -c %Y "$stamp"))) -lt "${SWEEP_SECONDS:-5}" ]; then
  exit 0
fi
touch "$stamp"

# tab_id -> original numeric label and the live label owned by this script
declare -A original owned live
if [ -f "$owned_file" ]; then
  while IFS=$'\t' read -r tab base label; do
    [ -n "$tab" ] || continue
    original["$tab"]=$base
    owned["$tab"]=$label
  done < "$owned_file"
fi

panes=$("$herdr" pane list 2>/dev/null) || exit 0
while IFS=$'\t' read -r tab label agent_status; do
  [ -n "$tab" ] || continue
  live["$tab"]=1

  mine=${owned[$tab]:-}
  if [ -n "$mine" ] && [ "$label" != "$mine" ]; then
    unset "owned[$tab]" "original[$tab]"
    continue
  fi
  if [ -z "$mine" ] && ! [[ "$label" =~ ^[0-9]+$ ]]; then
    continue
  fi

  new=
  if [ "$agent_status" = unknown ]; then
    while IFS= read -r pane; do
      [ -n "$pane" ] || continue
      mapfile -t argv < <(
        "$herdr" pane process-info --pane "$pane" 2>/dev/null |
          jq -r '.result.process_info.foreground_processes[0].argv[]?'
      )
      [ "${#argv[@]}" -gt 0 ] || continue
      new=$(candidate "${argv[@]}" | tr -d '[:cntrl:]' | cut -c1-32)
      [ -n "$new" ] && break
    done < <(jq -r --arg tab "$tab" '.result.panes[] | select(.tab_id == $tab) | .pane_id' <<<"$panes")
  fi

  if [ -n "$new" ] && [ "$new" != "$label" ]; then
    if "$herdr" tab rename "$tab" "$new" >/dev/null; then
      [ -n "$mine" ] || original["$tab"]=$label
      owned["$tab"]=$new
    fi
  elif [ -z "$new" ] && [ -n "$mine" ]; then
    if "$herdr" tab rename "$tab" "${original[$tab]}" >/dev/null; then
      unset "owned[$tab]" "original[$tab]"
    fi
  fi
done < <("$herdr" tab list | jq -r '.result.tabs[] | [.tab_id, .label, .agent_status] | @tsv')

tmp=$(mktemp "$state/proc-owned.XXXXXX")
trap 'rm -f "$tmp"; rmdir "$lock_dir" 2>/dev/null || true' EXIT
for tab in "${!owned[@]}"; do
  [ -n "${live[$tab]:-}" ] || continue
  printf '%s\t%s\t%s\n' "$tab" "${original[$tab]}" "${owned[$tab]}"
done | sort > "$tmp"
mv "$tmp" "$owned_file"
