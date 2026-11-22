#!/usr/bin/env bash
# Rebuild luma/staging: staging + every patch in patches.list + patch/fork-tooling, then a build of
# each patched package (slurp2, otome-forge) with a fork version. Pushes nothing; see push-sync.sh.
#
#   tools/fork/rebuild.sh           # rebuild on the current local staging
#   tools/fork/rebuild.sh --sync    # first move staging to upstream/staging and rebase every patch onto it
#
# FORK_BUILD=<n> sets the build number (default: one more than origin/luma/staging's, or 1 on a new
# upstream version). MARINARA_ENGINE_ROOT picks the Engine checkout the build uses (default ../Marinara-Engine).
set -euo pipefail

# Branch switches remove tools/fork from the tree, so run from a copy of patch/fork-tooling's tools,
# whatever branch is checked out now.
if [ -z "${FORK_REEXEC:-}" ]; then
  copy=$(mktemp -d)
  git archive patch/fork-tooling tools/fork | tar -x -C "$copy"
  FORK_REEXEC=1 exec bash "$copy/tools/fork/rebuild.sh" "$@"
fi
tools=$(dirname "$0")
cd "$(git rev-parse --show-toplevel)"
die() { echo "rebuild: $*" >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || die "the working tree has changes; commit or stash them"

patches=$(sed -e 's/#.*//' -e 's/[[:space:]]*$//' -e '/^$/d' "$tools/patches.list")

git fetch origin --prune
if [ "${1:-}" = "--sync" ]; then
  git fetch upstream
  git checkout -q -B staging upstream/staging
  for patch in $patches patch/fork-tooling; do
    git checkout -q "$patch"
    git rebase staging || die "rebase of $patch stopped; resolve it, finish with git rebase --continue, and run again without --sync"
  done
fi
for patch in $patches patch/fork-tooling; do
  git merge-base --is-ancestor staging "$patch" || die "$patch is not based on staging; run with --sync or rebase it"
done

git checkout -q -B luma/staging staging
for patch in $patches patch/fork-tooling; do
  git cherry-pick "staging..$patch" >/dev/null || die "cherry-pick of $patch stopped; the patches conflict with each other"
done

# Fork versions: the next upstream patch number with a prerelease suffix (0.4.21 -> 0.4.22-luma.1). It
# sorts above the upstream version it was built from and below the next upstream release, and the
# CHANGELOG stays newest first. Each package with a patch in patches.list (patch/slurp-*, patch/otome-*)
# gets its own version and notes.
fork_version() {
  local id=$1 upstream previous build
  upstream=$(sed -n "/id: \"$id\",/{n;s/.*version: \"\([^\"]*\)\".*/\1/p}" scripts/build-feature-packages.mjs)
  [[ "$upstream" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "unexpected $id version '$upstream'"
  local base="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))"
  previous=$(git show "origin/luma/staging:packages/$id/manifest.json" 2>/dev/null | sed -n 's/^  "version": "\(.*\)",$/\1/p' || true)
  case "$previous" in
    "$base"-luma.*) build=$(( ${previous##*-luma.} + 1 )) ;;
    *) build=1 ;;
  esac
  echo "$upstream $base-luma.${FORK_BUILD:-$build}"
}
notes_for() {
  sed -n "s/^patch\/$1-[^ #]*[[:space:]]*#[[:space:]]*//p" "$tools/patches.list" | paste -sd' ' -
}

built=()
for spec in slurp2:slurp otome-forge:otome; do
  id=${spec%%:*}
  package_notes=$(notes_for "${spec##*:}")
  [ -n "$package_notes" ] || continue
  read -r upstream_version version < <(fork_version "$id")
  node "$tools/stamp-version.mjs" "$version" "$upstream_version" "$package_notes" "$id"
  if [ "$id" = slurp2 ]; then
    "$tools/in-node.sh" node_modules/.bin/prettier --experimental-cli --log-level warn --write \
      packages/slurp2/src/engine/packages/client/src/slp/features/onboarding/slp-release.ts
  fi
  "$tools/in-node.sh" node scripts/build-feature-packages.mjs "$id"
  git add "packages/$id"
  built+=("$id $version")
done
[ ${#built[@]} -gt 0 ] || die "no package has a patch in patches.list"

# Light, and needs unzip, which the container image lacks: run on the host (Node 22 is enough).
node scripts/validate-catalog.mjs
node "$tools/retarget-catalog.mjs"
git add scripts/build-feature-packages.mjs artifacts catalog
summary=$(printf '%s, ' "${built[@]}")
git commit -q -m "chore(fork): build ${summary%, }" -m "Upstream base: $(git rev-parse staging)"
echo "luma/staging rebuilt with ${summary%, }. Check it, then run tools/fork/push-sync.sh."
