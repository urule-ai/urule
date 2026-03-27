# Changelog

All notable changes to the Urule platform are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-03-27

### Added

**Platform**
- 18 packages across libraries, services, plugins, and frontend
- 8 GitHub repositories under the urule-ai organization
- 278+ unit tests, 15 Playwright E2E specs

**Security**
- `@urule/auth-middleware` — JWT authentication for all 11 services
- Zod input validation on all POST/PATCH routes (~30 schemas)
- CORS lockdown with configurable `CORS_ORIGINS` env var
- `@fastify/rate-limit` on all services (100 req/min)
- Startup config validation (`validateConfig()`)
- Audit logging with `AuditLogger` class and NATS topics

**Services**
- `urule-registry` — Source of truth for orgs, workspaces, agents, runtimes, providers, conversations
- `urule-langgraph-adapter` — LangGraph + Anthropic Claude with WebSocket streaming
- `urule-runtime-broker` — Sandbox session allocation
- `urule-packages` — Package install/upgrade/remove lifecycle
- `urule-packagehub` — Package discovery with full-text search
- `urule-mcp-gateway` — MCP server registry, workspace bindings, tool catalog
- `urule-approvals` — Temporal-backed approval workflows with rich metadata
- `urule-governance` — OPA + OpenFGA policy/authz gateway
- `urule-channel-router` — Slack, Telegram, webhook normalization
- `urule-state` — Room presence, task ownership, widget state (NATS KV)
- `backstage-urule-plugin` — Backstage catalog sync

**Libraries**
- `@urule/spec` — Entity types, manifest JSON Schema, validators
- `@urule/events` — NATS event envelope, typed pub/sub, audit logger
- `@urule/orchestrator-contract` — Adapter interface + compliance test suite
- `@urule/authz` — OpenFGA SDK wrapper
- `@urule/widget-sdk` — Widget iframe bridge, manifest, registry
- `@urule/auth-middleware` — Fastify JWT plugin (Keycloak JWKS)

**Frontend (Office UI)**
- Next.js 14 with App Router, Tailwind CSS, Zustand, React Query
- 9 built-in widgets, widget zone system
- Toast notifications, error boundaries
- Skeleton loaders on all pages
- Light/dark/system theme with persistence
- Responsive mobile layout with collapsible sidebar
- Forgot-password page, ARIA accessibility
- Agent creation wizard with 50+ personality templates

**Infrastructure**
- Docker Compose (Phase 1 and Phase 6 stacks)
- HEALTHCHECK in all 12 Dockerfiles
- Graceful shutdown handlers in all services
- Structured Pino logging with configurable LOG_LEVEL
- Database indexes on search/filter columns
- Pagination on list endpoints
- OpenAPI/Swagger UI on all services (`/docs`)

**Developer Experience**
- Root `package.json` with npm workspaces
- Shared `tsconfig.base.json`, `.eslintrc.json`, `.prettierrc`
- Makefile with 15 targets
- GitHub Actions CI + E2E workflows
- Issue templates and PR template
- Dependency alignment (TypeScript ^5.5.0, Vitest ^2.0.0, Fastify ^5.0.0)

**Documentation**
- CLAUDE.md — AI assistant guide with 6 recipes
- ARCHITECTURE.md — Design decisions + system diagrams
- ROADMAP.md — ~140 improvement items
- USER-JOURNEYS.md — 12 UX journey sections + Playwright tests
- AI-JOURNEYS.md — 14 AI agent journeys
- SKILLS.md — Machine-readable capability reference
- CONTRIBUTING.md — Full development and testing guide
- GETTING-STARTED.md — Zero-to-hero setup guide
