#!/usr/bin/env bash
set -euo pipefail

echo "==> Fetching latest tags and branches from upstream (stablyai/orca)..."
git fetch upstream --tags --prune

LATEST_TAG=$(git tag -l "v*" --sort=-v:refname | head -n 1 || echo "main")
echo "==> Latest detected upstream release: ${LATEST_TAG}"

echo "==> Inspecting Orca plugin contracts & API changes..."
git log -n 5 --oneline upstream/main -- resources/plugins/ shared/plugins/ 2>/dev/null || echo "Checked upstream main."

echo "==> Upstream sync check complete."
