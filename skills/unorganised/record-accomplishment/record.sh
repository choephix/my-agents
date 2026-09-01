#!/usr/bin/env bash
# Reads a markdown document on stdin, files it as a dated accomplishment.
# Prints the final path. Takes no arguments.
set -euo pipefail

dir="${AGENTS_WIKI_DIR:-$HOME/agentspace/index/wiki}/accomplishments"
mkdir -p "$dir"

doc=$(cat)
[ -n "$doc" ] || { echo "record.sh: empty document on stdin" >&2; exit 1; }

# Title: first heading at the highest level present (# before ##, first wins).
title=""
for level in '#' '##' '###' '####' '#####' '######'; do
  title=$(printf '%s\n' "$doc" | sed -n "s/^$level \{1,\}//p" | sed -n 1p)
  [ -n "$title" ] && break
done
[ -n "$title" ] || title="untitled"

# Slug: lowercase, alnum runs -> dashes, first 5 tokens.
slug=$(printf '%s' "$title" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-//' -e 's/-$//' \
  | cut -d- -f1-5 \
  | sed 's/-$//')
[ -n "$slug" ] || slug="untitled"

# Collision guard: -2, -3, ... within the same minute.
stamp=$(date +%Y-%m-%d-%H%M)
path="$dir/$stamp-$slug.md"
n=2
while [ -e "$path" ]; do
  path="$dir/$stamp-$slug-$n.md"
  n=$((n + 1))
done

printf '%s\n' "$doc" > "$path"
echo "$path"
