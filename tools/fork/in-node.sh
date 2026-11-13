#!/usr/bin/env bash
# Run a command with Node 24 inside a capped container, for hosts with no native Node >= 24
# (the Docker host that runs the live Marinara server).
#
#   tools/fork/in-node.sh npm ci
#   tools/fork/in-node.sh node scripts/build-feature-packages.mjs slurp2
#
# Uses the Engine checkout's builder image (MARINARA_ENGINE_ROOT, default ../Marinara-Engine), built by
# the Engine's own tools/fork/in-node.sh. The Engine checkout is mounted read-only: builds use its
# node_modules and never change it. The container gets 6 GiB, no swap and CPUs 1-3, and carries the
# label marinara.guard=heavy so the host's memory guard can find it.
set -euo pipefail
[ $# -gt 0 ] || { echo "usage: $0 <command> [args...]" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "docker is required." >&2; exit 1; }

repo=$(git rev-parse --show-toplevel)
engine=$(realpath "${MARINARA_ENGINE_ROOT:-$repo/../Marinara-Engine}")
[ -f "$engine/Dockerfile" ] || { echo "no Engine checkout at $engine (set MARINARA_ENGINE_ROOT)" >&2; exit 1; }
base=$(sed -n 's/^FROM \(node:[^ ]*\) AS builder$/\1/p' "$engine/Dockerfile")
image="marinara-node-dev:$(printf %s "$base" | sha256sum | cut -c1-12)"
docker image inspect "$image" >/dev/null 2>&1 || {
  echo "missing $image: run the Engine's tools/fork/in-node.sh once to build it" >&2
  exit 1
}
if [ -n "$(docker ps -q --filter label=marinara.guard=heavy)" ]; then
  echo "another heavy container is running (docker ps --filter label=marinara.guard=heavy); wait for it" >&2
  exit 1
fi
cache="${MARINARA_NODE_CACHE:-$HOME/.cache/marinara-node-container}"
mkdir -p "$cache"
mounts=(-v "$repo:$repo" -v "$engine:$engine:ro")
common=$(realpath "$(git rev-parse --git-common-dir)")
case "$common/" in "$repo"/*) ;; *) mounts+=(-v "$common:$common") ;; esac
exec docker run --rm -i $([ -t 0 ] && echo -t) \
  --memory "${MARINARA_NODE_MEMORY:-6g}" --memory-swap "${MARINARA_NODE_MEMORY:-6g}" \
  --cpuset-cpus "${MARINARA_NODE_CPUS:-1-3}" \
  --label marinara.guard=heavy \
  --user "$(id -u):$(id -g)" \
  --security-opt label=disable \
  -e HOME=/cache -e CI=true -e MARINARA_ENGINE_ROOT="$engine" \
  -v "$cache:/cache" "${mounts[@]}" -w "$PWD" \
  "$image" nice -n 10 "$@"
