#!/usr/bin/env bash
# Rebuild luma/staging: staging + every patch in patches.list + patch/fork-tooling, then a slurp2
# build with a fork version. Pushes nothing; see push-sync.sh.
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
notes=$(sed -n 's/^patch\/[^ #]*[[:space:]]*#[[:space:]]*//p' "$tools/patches.list")

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

# Fork version: the next upstream patch number with a prerelease suffix (0.4.21 -> 0.4.22-luma.1). It
# sorts above the upstream version it was built from and below the next upstream release, and the
# CHANGELOG stays newest first.
upstream_version=$(sed -n '/id: "slurp2",/{n;s/.*version: "\([^"]*\)".*/\1/p}' scripts/build-feature-packages.mjs)
[[ "$upstream_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "unexpected slurp2 version '$upstream_version'"
fork_base="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))"
previous=$(git show origin/luma/staging:packages/slurp2/manifest.json 2>/dev/null | sed -n 's/^  "version": "\(.*\)",$/\1/p' || true)
case "$previous" in
  "$fork_base"-luma.*) build=$(( ${previous##*-luma.} + 1 )) ;;
  *) build=1 ;;
esac
version="$fork_base-luma.${FORK_BUILD:-$build}"
node "$tools/stamp-version.mjs" "$version" "$upstream_version" "$(printf '%s' "$notes" | paste -sd' ' -)"
"$tools/in-node.sh" node_modules/.bin/prettier --experimental-cli --log-level warn --write \
  packages/slurp2/src/engine/packages/client/src/slp/features/onboarding/slp-release.ts

"$tools/in-node.sh" node scripts/build-feature-packages.mjs slurp2
# Light, and needs unzip, which the container image lacks: run on the host (Node 22 is enough).
node scripts/validate-catalog.mjs
node "$tools/retarget-catalog.mjs"
git add scripts/build-feature-packages.mjs packages/slurp2 artifacts catalog
git commit -q -m "chore(fork): build slurp2 $version" -m "Upstream base: $(git rev-parse staging)"
echo "luma/staging rebuilt with slurp2 $version. Check it, then run tools/fork/push-sync.sh."
