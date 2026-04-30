#!/usr/bin/env bash
# Clone all standalone Urule ecosystem repos as siblings of this repo.
# Usage: ./scripts/clone-all.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PARENT_DIR="$(dirname "$ROOT_DIR")"

ORG="urule-ai"
REPOS=(
  widget-sdk
  orchestrator-contract
  mcp-gateway
  channel-router
  approvals
  runtime-broker
  orchestrator-adapters
)

echo "Cloning Urule ecosystem repos into $PARENT_DIR..."
echo ""

for repo in "${REPOS[@]}"; do
  target="$PARENT_DIR/$repo"
  if [ -d "$target" ]; then
    echo "  $repo — already exists, pulling latest..."
    (cd "$target" && git pull --ff-only 2>/dev/null || echo "    (pull skipped — may have local changes)")
  else
    echo "  $repo — cloning..."
    git clone "https://github.com/$ORG/$repo.git" "$target"
  fi
done

echo ""
echo "Done! All repos cloned to $PARENT_DIR/"
echo ""
echo "Directory structure:"
for repo in "${REPOS[@]}"; do
  echo "  $PARENT_DIR/$repo/"
done
echo "  $ROOT_DIR/ (this repo)"
