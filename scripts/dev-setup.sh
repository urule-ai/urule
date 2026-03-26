#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Urule Development Setup ==="
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required (v20+)"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Error: Docker is required"; exit 1; }

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Error: Node.js 20+ required (found $(node -v))"
  exit 1
fi

echo "1. Cloning ecosystem repos..."
"$SCRIPT_DIR/clone-all.sh"

echo ""
echo "2. Installing dependencies..."
cd "$ROOT_DIR"
npm install

echo ""
echo "3. Building packages..."
npm run build:all 2>/dev/null || echo "   (some packages may need infrastructure to build)"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  make infra-up    # Start PostgreSQL, NATS, and all services"
echo "  make dev-ui      # Start the Office UI at http://localhost:3000"
echo "  make test        # Run all tests"
echo "  make e2e         # Run E2E integration tests"
