.PHONY: dev test build lint typecheck clean setup clone-deps infra-up infra-down e2e dev-ui

# Clone all standalone ecosystem repos
clone-deps:
	./scripts/clone-all.sh

# Install all dependencies
setup: clone-deps
	npm install
	@echo "Dependencies installed for all workspaces"

# Run all tests
test:
	npm run test:all

# Build all packages
build:
	npm run build:all

# Lint all packages
lint:
	npm run lint:all

# Type check all packages
typecheck:
	npm run typecheck:all

# Start infrastructure (Docker Compose)
infra-up:
	cd infra/compose && docker compose -f docker-compose.phase6.yaml up --build -d

# Stop infrastructure
infra-down:
	cd infra/compose && docker compose -f docker-compose.phase6.yaml down

# Run E2E tests
e2e:
	cd infra && ./scripts/run-phase1.sh

# Clean all build artifacts
clean:
	npm run clean 2>/dev/null; true
	find . -name "dist" -type d -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null; true
	find . -name "*.tsbuildinfo" -delete 2>/dev/null; true

# Development: start office UI
dev-ui:
	cd apps/office-ui && npm run dev

# Full dev setup from scratch
dev: setup infra-up dev-ui
