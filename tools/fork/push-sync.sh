#!/usr/bin/env bash
# Push staging, every patch branch, patch/fork-tooling and luma/staging to origin and to each mirror
# remote in `git config fork.mirror`, with --force-with-lease --force-if-includes.
#
#   tools/fork/push-sync.sh [--dry-run]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
dry=()
[ "${1:-}" = "--dry-run" ] && dry=(--dry-run)
list=$(git show patch/fork-tooling:tools/fork/patches.list)
patches=$(printf '%s\n' "$list" | sed -e 's/#.*//' -e 's/[[:space:]]*$//' -e '/^$/d')
branches=(staging $patches patch/fork-tooling luma/staging)
for branch in "${branches[@]}"; do
  git merge-base --is-ancestor staging "$branch" ||
    { echo "push-sync: $branch is not based on staging; rebuild first" >&2; exit 1; }
done
for remote in origin $(git config --get-all fork.mirror || true); do
  git fetch "$remote" --prune
  git push "${dry[@]}" --force-with-lease --force-if-includes "$remote" "${branches[@]}"
done
