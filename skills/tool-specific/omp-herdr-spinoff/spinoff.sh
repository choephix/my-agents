#!/usr/bin/env bash
# spinoff — cut (or reuse) a branch as a herdr worktree, launch N omp agents on one brief.
#
# usage: spinoff.sh -b <branch> -f <brief.md> [-m <model>]... [-r <repo>] [-B <ref>] [-t <desc>]
#   -b  branch: created off -B if new; checked out as-is if it already exists (local or origin)
#   -f  brief file every launched agent starts from
#   -m  repeatable: one omp tab per model, e.g. -m sol -m opus  (none -> one default-model agent)
#   -r  repo to cut from            (default: git toplevel of $PWD)
#   -B  base ref for a NEW branch   (default: origin/main)
#   -t  tab description suffix      (tabs named <branch>-<model>[-<desc>])
set -euo pipefail

repo="" base_ref="origin/main" branch="" brief="" tab_desc=""
models=()
while getopts "b:f:m:r:B:t:" o; do case $o in
  b) branch=$OPTARG;; f) brief=$OPTARG;; m) models+=("$OPTARG");;
  r) repo=$OPTARG;; B) base_ref=$OPTARG;; t) tab_desc=$OPTARG;;
  *) exit 2;;
esac; done
[[ -n $branch && -f ${brief:-} ]] || { echo "need -b <branch> and -f <existing brief>" >&2; exit 2; }
[[ -n $repo ]] || repo=$(git -C "$PWD" rev-parse --show-toplevel)
((${#models[@]})) || models=("")   # one tab, omp's default model

# 1. resolve base off fresh origin; an existing branch wins over base_ref
git -C "$repo" fetch origin
if   git -C "$repo" show-ref -q --verify "refs/heads/$branch";          then base=$(git -C "$repo" rev-parse "$branch")
elif git -C "$repo" show-ref -q --verify "refs/remotes/origin/$branch"; then base=$(git -C "$repo" rev-parse "origin/$branch")
else base=$(git -C "$repo" rev-parse "$base_ref"); fi

# 2. one worktree, its own workspace; label = branch
json=$(herdr worktree create --cwd "$repo" --branch "$branch" \
        --base "$base" --label "$branch" --no-focus)
ws=$(jq   -r .result.root_pane.workspace_id <<<"$json")
root=$(jq -r .result.root_pane.cwd          <<<"$json")

panes=() labels=()
panes+=("$(jq -r .result.root_pane.pane_id <<<"$json")")
labels+=("${branch}-${models[0]:-default}${tab_desc:+-$tab_desc}")
herdr tab rename "$(jq -r .result.root_pane.tab_id <<<"$json")" "${labels[0]}"

# 3. one extra tab per additional model, same worktree
for m in "${models[@]:1}"; do
  tj=$(herdr tab create --workspace "$ws" --cwd "$root" \
        --label "${branch}-${m}${tab_desc:+-$tab_desc}" --no-focus)
  panes+=("$(jq -r '.result.root_pane.pane_id' <<<"$tj" | head -1)")
  labels+=("${branch}-${m}${tab_desc:+-$tab_desc}")
done

# 4. launch every agent on the same brief (panes don't inherit mise shims -> explicit PATH)
for i in "${!panes[@]}"; do
  m=${models[$i]:-}
  herdr pane run "${panes[$i]}" \
    "export PATH=\"\$HOME/.local/share/mise/shims:\$HOME/.bun/bin:\$PATH\"; omp ${m:+--model $m }@$brief"
done

# 5. verify each pane has a live omp with cwd inside the worktree
ok=0
for _ in $(seq 1 15); do
  sleep 2; ok=0
  for p in "${panes[@]}"; do
    jq -e --arg root "$root" \
      '.result.process_info.foreground_processes[]? | select(.name=="omp" and (.cwd|startswith($root)))' \
      <<<"$(herdr pane process-info --pane "$p" 2>/dev/null || true)" >/dev/null && ((ok++)) || true
  done
  ((ok == ${#panes[@]})) && break
done

echo "worktree: $root"
echo "branch:   $branch @ $base"
echo "workspace: $ws  panes: ${panes[*]}"
echo "tabs:     ${labels[*]}"
echo "brief:    $brief"
echo "agents:   $ok/${#panes[@]} up"
((ok == ${#panes[@]})) || { echo "some panes dead — check: herdr pane read <pane>" >&2; exit 1; }
