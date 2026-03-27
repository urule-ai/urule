# Contributing to Urule

Thank you for your interest in contributing! Urule is an open platform for making AI more usable, and we welcome contributions from everyone.

## Quick Start

```bash
# Clone and set up
git clone https://github.com/urule-ai/urule.git
cd urule
make setup          # Clones ecosystem repos, installs deps

# Start services
make infra-up       # Boot PostgreSQL, NATS, all backend services
make dev-ui         # Start Office UI at http://localhost:3000

# Run tests
make test           # Unit tests (all packages)
make e2e-playwright # Playwright E2E tests
make e2e-ui         # Playwright interactive UI mode
```

## Development Setup

- **Runtime**: Node.js 20+ (pinned in `.nvmrc`)
- **Language**: TypeScript (ESM modules, strict mode)
- **HTTP Framework**: Fastify 5
- **Test Runner**: Vitest (unit) + Playwright (E2E)
- **Database**: PostgreSQL 16 (schema-per-service via Drizzle ORM)
- **Events**: NATS (inter-service communication)
- **Frontend**: Next.js 14, React 18, Tailwind CSS, Zustand

## Code Style

- ESM-only (`"type": "module"` in package.json)
- TypeScript strict mode
- Use `ulid()` for ID generation
- Prefer Fastify plugins and decorators
- Shared configs: `tsconfig.base.json`, `.eslintrc.json`, `.prettierrc`

## Testing

### Unit Tests (Vitest)

```bash
make test                    # Run all unit tests
cd services/registry && npm test  # Run tests for a specific service
```

### E2E Tests (Playwright)

Playwright tests map 1:1 to the [User Journeys](USER-JOURNEYS.md) document.

```bash
# Install Playwright browsers (first time)
make playwright-install

# Run all E2E tests (headless)
make e2e-playwright

# Run with interactive UI (pick & debug tests)
make e2e-ui

# Run with browser visible
make e2e-headed

# View HTML test report
make e2e-report
```

### Adding New Tests

**Unit tests**: Add `*.test.ts` files in the service's `tests/` directory. Follow existing patterns with `app.inject()` for route testing.

**E2E tests**: Add `*.spec.ts` files in `apps/office-ui/e2e/`. Use the auth fixture for authenticated pages:

```typescript
import { test, expect } from './fixtures/auth';

test.describe('My Journey', () => {
  test('should do something', async ({ authenticatedPage: page }) => {
    await page.goto('/office/my-page');
    await expect(page.getByText('Expected content')).toBeVisible();
  });
});
```

## Adding User Journeys

User journeys are documented in [USER-JOURNEYS.md](USER-JOURNEYS.md). To add a new one:

1. **Document it** — Add a section to USER-JOURNEYS.md with:
   - Step-by-step flow table
   - UX test checklist
   - Future improvement ideas

2. **Write the Playwright spec** — Create `apps/office-ui/e2e/<journey-name>.spec.ts`

3. **Submit a PR** — Reference the journey in your PR description

## AI-Assisted Development

Urule is designed to be AI-friendly. Whether you use Claude Code, Cursor, GitHub Copilot, or another AI assistant, these files help:

| File | Purpose |
|------|---------|
| [CLAUDE.md](CLAUDE.md) | Comprehensive guide: patterns, recipes, conventions, anti-patterns |
| [.cursorrules](.cursorrules) | Concise coding rules for Cursor AI |
| [.github/copilot-instructions.md](.github/copilot-instructions.md) | GitHub Copilot workspace instructions |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design decisions and system diagrams |

### AI-Friendly Recipes in CLAUDE.md

CLAUDE.md contains step-by-step recipes for common tasks:
- **How to add a new API route** — Zod schema + Fastify handler + tests
- **How to add a new service** — Full service scaffold with middleware stack
- **How to add a new widget** — Manifest + component + registration
- **How to add a new event type** — Topic + type + export
- **How to add a channel adapter** — Interface implementation + registration
- **How to add an orchestrator adapter** — Contract + compliance tests

When using an AI assistant, point it to CLAUDE.md first for the best results.

## Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Ensure `make test` and `make e2e-playwright` pass
5. Commit with a clear message (e.g., `feat: add webhook retry logic`)
6. Open a Pull Request

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `test:` — adding or updating tests
- `chore:` — maintenance tasks

## Project Structure

```
urule/
  packages/     — shared libraries (spec, events, authz, auth-middleware)
  services/     — backend microservices (registry, governance, state, etc.)
  plugins/      — platform integrations (backstage)
  apps/         — frontend applications (office-ui)
  infra/        — Docker Compose, scripts, SQL seeds
  scripts/      — dev setup, clone-all
```

See [ROADMAP.md](ROADMAP.md) for improvement items to pick up, and [USER-JOURNEYS.md](USER-JOURNEYS.md) for the complete UX test plan.

## Reporting Issues

- Use [GitHub Issues](https://github.com/urule-ai/urule/issues) to report bugs or request features
- Use the bug report or feature request templates
- Include steps to reproduce for bugs
- For security issues, please email the maintainers directly

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
