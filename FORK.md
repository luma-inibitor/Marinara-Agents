# Fork workflow

This is a fork of [Pasta-Devs/Marinara-Agents](https://github.com/Pasta-Devs/Marinara-Agents), kept at
[luma-inibitor/Marinara-Agents](https://github.com/luma-inibitor/Marinara-Agents). It carries local
patches to Slurp (`slurp2`) and publishes a full Agent catalog that a Marinara Engine can read instead of
the official one.

## Branches

| Branch               | Role                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `staging`            | Pristine mirror of `upstream/staging`. Never commit here.                                |
| `patch/*`            | One branch per fix, based on `staging`, each with its own regression test in `tests/`.   |
| `patch/fork-tooling` | This file, `tools/fork/`, and a release-notes test that accepts the fork version. Applied after the patches. |
| `luma/staging`       | `staging` + patches + fork tooling + one generated slurp2 build commit. Rebuilt, never edited. |

`patch/*` branches change source and tests only. Generated files (`packages/slurp2/client.js`,
`server.mjs`, `manifest.json`, `artifacts/`, `catalog/`) change only in the build commit on
`luma/staging`, so patches never conflict over them.

## Patches

See `tools/fork/patches.list`. Its `#` sentences become the fork build's release note.

## The catalog

The Engine reads the fork when it runs with:

```sh
MARINARA_AGENT_CATALOG_URL=https://raw.githubusercontent.com/luma-inibitor/Marinara-Agents/luma/staging/catalog/v2/catalog.json
```

`v2` is the lane for Engine 2.x. With this override:

- The Engine downloads each entry's `artifact.url` as written and checks it against the entry's
  `sha256`. `tools/fork/retarget-catalog.mjs` points every artifact, artwork and language-pack URL at
  `luma/staging`, so every package, upstream ones included, comes from this fork.
- `notes.json` and `store.json` are read beside the catalog, from the fork.
- The staging preview overlay (`catalog/preview/`) is not read. Packages that exist only there are not
  offered.
- The Agents page labels the catalog as custom.

The fork's slurp2 version is the next upstream patch number with a `-luma.<n>` suffix: a build of
upstream `0.4.21` is `0.4.22-luma.1`, then `0.4.22-luma.2`. It sorts above the upstream version it was
built from, so the Engine offers it as an update. It sorts below the next upstream release (`0.4.22`), so
the official catalog would offer that release over it. The package CHANGELOG stays newest first, which the
catalog build requires.

## Rebuild `luma/staging`

```sh
tools/fork/rebuild.sh          # on the current staging
tools/fork/rebuild.sh --sync   # first move staging to upstream/staging and rebase every patch
tools/fork/push-sync.sh --dry-run
tools/fork/push-sync.sh
```

`rebuild.sh` cherry-picks the patches onto `staging`, sets the slurp2 version, adds a CHANGELOG and
splash entry (`stamp-version.mjs`), builds slurp2, validates the catalog, retargets the catalog URLs and commits. It pushes nothing.
`push-sync.sh` pushes `staging`, the patches, `patch/fork-tooling` and `luma/staging` to `origin` and to
every remote in `git config fork.mirror`, with `--force-with-lease --force-if-includes`.

The build needs an Engine checkout with `node_modules` (`MARINARA_ENGINE_ROOT`, default
`../Marinara-Engine`). The Engine must be new enough for the capability API slurp2 declares (see
`packages/slurp2/manifest.json`, `capabilityApi`).

### After an upstream sync

- A patch that rebases to nothing was adopted upstream: delete its branch and its line in `patches.list`.
- A conflict stops the rebase. Resolve it on the patch branch, then run `rebuild.sh` without `--sync`.
- Upstream may change a line a patch's test asserts on. Fix the test on the patch branch.
- Run the slurp2 tests on `luma/staging` before pushing (below).

## Add a patch

```sh
git checkout -B patch/<topic> staging
# change source, add tests/slurp2-<topic>.regression.ts, commit
```

Add the branch to `tools/fork/patches.list` on `patch/fork-tooling`, then rebuild and push.

## Validate

On a host with no Node 24, run each command through `tools/fork/in-node.sh`. It runs one container with
6 GiB, no swap and CPUs 1-3, labelled `marinara.guard=heavy`, mounts the Engine checkout read-only, and
refuses to start while another heavy container runs.

```sh
tools/fork/in-node.sh npm ci
tools/fork/in-node.sh node scripts/run-slurp-regressions.mjs
tools/fork/in-node.sh node scripts/typecheck-packages.mjs slurp2
tools/fork/in-node.sh node_modules/.bin/tsx --tsconfig tests/tsconfig.regressions.json tests/slurp2-architecture.regression.ts
```
