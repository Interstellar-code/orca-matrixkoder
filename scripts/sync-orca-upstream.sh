#!/usr/bin/env bash
set -euo pipefail

# Remotes: `upstream` = Interstellar-code/matrixkoder (the MK logic this plugin follows),
# `orca` = stablyai/orca (the host IDE's plugin API). Both have unrelated histories,
# so they are fetched for reference only, never merged.

latest_tag() {
  git ls-remote --tags --refs "$1" 'v*' | awk -F/ '{print $NF}' | sort -V | tail -n 1
}

echo "==> Fetching upstream (Interstellar-code/matrixkoder)..."
git fetch upstream --prune --no-tags
echo "==> Latest upstream MatrixKoder release: $(latest_tag upstream || echo none)"
git log -n 5 --oneline upstream/main 2>/dev/null || echo "No upstream/main branch found."

echo "==> Fetching orca (stablyai/orca)..."
git fetch orca --prune --no-tags
echo "==> Latest Orca release: $(latest_tag orca || echo none)"

echo "==> Inspecting Orca plugin contracts & API changes..."
git log -n 5 --oneline orca/main -- resources/plugins/ shared/plugins/ 2>/dev/null || echo "Checked orca main."

echo "==> Upstream sync check complete."
