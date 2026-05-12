.PHONY: dev test build lint typecheck clean setup clone-deps infra-up infra-down e2e e2e-ui e2e-playwright e2e-headed e2e-report playwright-install dev-ui

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

# Start infrastructure (Docker Compose).
# Seeds infra/compose/.env (gitignored) from the .env.example template the first
# time — the compose files require credentials via `${VAR:?}`, no defaults.
infra-up:
	cd infra/compose && { [ -f .env ] || cp .env.example .env; } && docker compose -f docker-compose.phase6.yaml up --build -d

# Stop infrastructure
infra-down:
	cd infra/compose && { [ -f .env ] || cp .env.example .env; } && docker compose -f docker-compose.phase6.yaml down

# Run backend E2E tests (Phase 1 API tests)
e2e:
	cd infra && ./scripts/run-phase1.sh

# Run Playwright UI E2E tests
e2e-ui:
	cd apps/office-ui && npx playwright test --ui

# Run Playwright tests headless
e2e-playwright:
	cd apps/office-ui && npx playwright test

# Run Playwright tests with browser visible
e2e-headed:
	cd apps/office-ui && npx playwright test --headed

# View Playwright HTML report
e2e-report:
	cd apps/office-ui && npx playwright show-report

# Install Playwright browsers
playwright-install:
	cd apps/office-ui && npx playwright install chromium

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
