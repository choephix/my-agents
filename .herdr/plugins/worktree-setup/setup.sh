#!/usr/bin/env bash
#
# worktree.created -> run a per-repo setup hook inside the new worktree.
#
# Hook lookup, first match wins:
#   1. <repo_root>/.herdr/worktree-setup.sh          versioned with the repo
#   2. <plugin_config_dir>/hooks/<repo_name>.sh      private, for repos you
#                                                    should not add files to
#
# Opt-in: a repo with no hook is skipped silently. The hook is always read from
# the ORIGINAL checkout, never from the new worktree, so a branch cannot change
# how its own worktree gets prepared.
#
# The hook runs with cwd = the new worktree and these extra variables:
#   HERDR_WORKTREE_PATH       absolute path of the new worktree
#   HERDR_WORKTREE_BRANCH     its branch (or "detached")
#   HERDR_WORKTREE_REPO_ROOT  the original checkout the worktree came from
#   HERDR_WORKTREE_REPO_NAME  short repo name
# plus herdr's own HERDR_* (WORKSPACE_ID, TAB_ID, PANE_ID, SOCKET_PATH...), so a
# hook may open panes or rename the workspace via `herdr`.
#
# Note: plugin PATH has no mise shims; a hook needing mise-managed tools must add
# them itself.
set -uo pipefail

HOOK_REL=".herdr/worktree-setup.sh"

if [ "${1:-}" != "--run" ]; then
  # Fires for both the event (worktree.created) and the manual `rerun` action;
  # the worktree pair lives in different places in each payload.
  read -r repo_root checkout repo_name < <(
    jq -rn --argjson ev "${HERDR_PLUGIN_EVENT_JSON:-null}" \
           --argjson cx "${HERDR_PLUGIN_CONTEXT_JSON:-null}" '
      [ $ev.data.workspace.worktree, $cx.worktree ]
      | map(select(type == "object"))
      | (first // {})
      | [ (.repo_root // "-"), (.checkout_path // "-"), (.repo_name // "-") ]
      | @tsv'
  )

  [ "$repo_root" != "-" ] && [ "$checkout" != "-" ] || exit 0
  [ "$repo_root" != "$checkout" ] || exit 0

  # In-repo hook wins (versioned, team-shared). Repos you cannot or should not
  # add a .herdr/ dir to fall back to a private hook named after the repo.
  hook="$repo_root/$HOOK_REL"
  [ -f "$hook" ] || hook="${HERDR_PLUGIN_CONFIG_DIR:-$HOME/.config/herdr/plugins/config/stefan.worktree-setup}/hooks/$repo_name.sh"
  [ -f "$hook" ] || exit 0

  branch=$(git -C "$checkout" rev-parse --abbrev-ref HEAD 2>/dev/null) || branch="detached"

  export WTS_HOOK="$hook" \
         HERDR_WORKTREE_PATH="$checkout" \
         HERDR_WORKTREE_BRANCH="$branch" \
         HERDR_WORKTREE_REPO_ROOT="$repo_root" \
         HERDR_WORKTREE_REPO_NAME="$repo_name"

  # The `rerun` action is an explicit request to redo the work; only the event
  # sets HERDR_PLUGIN_EVENT. A hook that can skip already-done setup should
  # honour this.
  [ -n "${HERDR_PLUGIN_EVENT:-}" ] || export HERDR_WORKTREE_SETUP_FORCE=1

  # Detach: setup means installs and builds. herdr must not wait on it, and no
  # future event timeout should be able to kill it mid-install.
  setsid bash "$0" --run </dev/null >/dev/null 2>&1 &
  exit 0
fi

slug=$(printf '%s-%s' "$HERDR_WORKTREE_REPO_NAME" "$HERDR_WORKTREE_BRANCH" | tr -c 'A-Za-z0-9._-' '_')
log_dir="${HERDR_PLUGIN_STATE_DIR:-$HOME/.local/state/herdr/plugins/stefan.worktree-setup}/logs"
mkdir -p "$log_dir"
log="$log_dir/$slug.log"

{
  echo "=== $(date -Iseconds)  $HERDR_WORKTREE_BRANCH"
  echo "    hook:  $WTS_HOOK"
  echo "    cwd:   $HERDR_WORKTREE_PATH"
  echo "    via:   ${HERDR_PLUGIN_EVENT:-action}  force=${HERDR_WORKTREE_SETUP_FORCE:-0}"
} >"$log"

cd "$HERDR_WORKTREE_PATH" || exit 1

start=$SECONDS
if [ -x "$WTS_HOOK" ]; then "$WTS_HOOK"; else bash "$WTS_HOOK"; fi >>"$log" 2>&1
rc=$?
took=$((SECONDS - start))
echo "=== exit $rc after ${took}s" >>"$log"

if [ "$rc" -eq 0 ]; then
  herdr notification show "worktree ready · $HERDR_WORKTREE_BRANCH" \
    --body "$HERDR_WORKTREE_REPO_NAME · ${took}s" --sound done >/dev/null 2>&1
else
  herdr notification show "worktree setup FAILED · $HERDR_WORKTREE_BRANCH" \
    --body "exit $rc · $log" --sound request >/dev/null 2>&1
fi

exit "$rc"
