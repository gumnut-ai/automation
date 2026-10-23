#!/usr/bin/env bash
# The shared lock owns wrapper and platform binary integrity; scripts stay disabled.
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
runtime_dir="$RUNNER_TEMP/gh-aw/codex-runtime"
mkdir -p "$RUNNER_TEMP/gh-aw"
# Refuse to reuse an existing package tree or caller-supplied npm configuration.
mkdir "$runtime_dir"
cp "$source_dir/"package{,-lock}.json "$runtime_dir/"
install_home=$(mktemp -d "$RUNNER_TEMP/gh-aw/codex-install-home.XXXXXX")
trap 'rm -rf -- "$install_home"' EXIT
cd -- "$runtime_dir"
env -i PATH="$PATH" HOME="$install_home" npm ci --ignore-scripts \
  --prefix "$runtime_dir" --cache "$RUNNER_TEMP/gh-aw/npm-cache"
# Preserve native detector PATH discovery and the existing AWF read-only mounts.
runtime_bin="$RUNNER_TOOL_CACHE/scheduled-care-codex/0.156.1/bin"
mkdir -p "$runtime_bin"
ln -s "$runtime_dir/node_modules/.bin/codex" "$runtime_bin/codex"
env -i PATH="$PATH" HOME="$install_home" "$runtime_bin/codex" --version
