# Urule Roadmap

This document tracks improvements, fixes, and features across the entire Urule ecosystem. Items are organized by priority and category. Each item includes sub-tasks scoped to specific repos/packages.

**Want to contribute?** Pick any unchecked item, open an issue referencing it, and submit a PR. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## 1. Security (Critical)

These items must be addressed before any production deployment.

### 1.1 Authentication Middleware ✅
Add JWT validation middleware to all service routes.

- [x] **registry** — Add `@fastify/jwt` plugin, validate Bearer tokens on all `/api/v1/*` routes
- [x] **langgraph-adapter** — Add JWT middleware to chat, runs, and WebSocket endpoints
- [x] **approvals** — Add JWT middleware; extract user identity for approval audit trail
- [x] **mcp-gateway** — Add JWT middleware to server registration and binding routes
- [x] **channel-router** — Add JWT middleware (except webhook ingestion endpoints which use HMAC)
- [x] **packagehub** — Add JWT middleware to publish/version routes (read routes can be public)
- [x] **state** — Add JWT middleware to presence and task ownership routes
- [x] **governance** — Add JWT middleware; this service validates auth for others
- [x] **runtime-broker** — Add JWT middleware to session allocation routes
- [x] **backstage plugin** — Add service-to-service auth token validation
- [x] **Shared**: Create `@urule/auth-middleware` package with reusable Fastify plugin

### 1.2 Input Validation ✅
Add request body/query validation on all API routes.

- [x] **registry** — Validate agent creation, workspace updates, provider creation, conversations, auth with Zod schemas
- [x] **approvals** — Validate approval request body, approve/deny/escalate/request-changes
- [x] **mcp-gateway** — Validate MCP server registration, tool registration, binding creation
- [x] **channel-router** — Validate channel binding, identity mapping, send message payloads
- [x] **state** — Validate room creation (capacity, type), presence, tasks, widget state updates
- [x] **packagehub** — Validate package publish payload and search query parameters (limit, offset)
- [x] **langgraph-adapter** — Validate run start params, chat message, chat actions, artifacts
- [x] **runtime-broker** — Validate session allocation request
- [x] **All services**: Using Zod `safeParse()` with 400 error responses including detailed issue descriptions

### 1.3 CORS Lockdown ✅
Replace `origin: true` (allow all) with explicit origin whitelist.

- [x] **registry** — Configurable via `CORS_ORIGINS` env var (defaults to `http://localhost:3000`)
- [x] **packagehub** — Same configurable origin whitelist
- [x] **state** — Same configurable origin whitelist
- [x] **langgraph-adapter** — Same configurable origin whitelist
- [x] **approvals** — Same configurable origin whitelist

### 1.4 Rate Limiting ✅
Add `@fastify/rate-limit` to prevent abuse.

- [x] **All 11 services** — `@fastify/rate-limit` with 100 req/min per IP
- [x] **langgraph-adapter** — Stricter limit: 30 req/min (AI execution is expensive)

### 1.5 Environment & Config Validation ✅
Validate required environment variables at startup; fail fast if missing.

- [x] **9 services** — `validateConfig()` checks DATABASE_URL, NATS_URL, REGISTRY_URL at startup
- [x] **governance** — Warns if `OPENFGA_STORE_ID` is empty
- [x] **registry, packagehub, mcp-gateway** — Removed hardcoded `urule:urule@localhost` defaults; `validateConfig()` now throws (not warns) when `DATABASE_URL` or `NATS_URL` is missing
- [x] **langgraph-adapter** — Added `src/middleware/error-handler.ts` with `redactSecrets()` covering `sk-ant-…`, OpenAI `sk-…`, `Bearer …`, `authorization:`, `x-api-key:`, and `?api_key=`/`?access_token=` query params. Redacts both response bodies AND log lines (incl. `error.message` and `error.stack`)
- [ ] **state, governance, approvals, channel-router, langgraph-adapter, runtime-broker** — Extend fail-fast pattern to remaining 6 services (currently warn-only). Mirror the registry/packagehub/mcp-gateway pattern.
- [ ] **registry, packagehub, governance, mcp-gateway** — Lift `redactSecrets` from langgraph-adapter into a shared util (e.g. `@urule/events/redaction` or new `@urule/errors`) and import from each service's `src/middleware/error-handler.ts`. Today only langgraph-adapter redacts; other services' error paths can still leak secrets in error messages or stack traces.

### 1.6 Audit Logging ✅
Track who did what and when for compliance.

- [x] **registry** — Log agent creation/update/status, provider CRUD, auth login with user identity
- [x] **approvals** — Log approve/deny/escalate decisions with approver identity
- [x] **governance** — Log policy evaluations and authz check denials
- [x] **mcp-gateway** — Log MCP server registration and deletion
- [x] **Shared**: `AuditLogger` class + `AuditEvent` type + `AUDIT_TOPICS` in `@urule/events`

---

## 2. Testing (High)

### 2.1 Unit Test Coverage ✅
Fill gaps in services that lack route-level tests.

- [x] **registry** — 6 route tests (auth validation, health check, mock user)
- [x] **packagehub** — 6 route tests (publish validation, version validation)
- [x] **langgraph-adapter** — 8 route tests (chat/run validation, capabilities)
- [x] **backstage plugin** — 3 route tests (catalog, scaffolder, health)
- [x] **channel-router** — Validation tests added to existing suite
- [x] **packages** — 5 route tests (install/upgrade validation)
- [x] **All services** — Zod validation tests cover invalid input (400s) across all services

### 2.2 E2E Integration Tests
Extend the Phase 1 E2E suite to cover all phases.

- [ ] **Phase 2 E2E** — Test package install lifecycle: publish to PackageHub → install via packages service → verify in registry
- [ ] **Phase 3 E2E** — Test approval workflow: create approval → approve/deny → verify event published
- [ ] **Phase 4 E2E** — Test channel routing: send webhook → verify normalized message → check state updates
- [ ] **Phase 5 E2E** — Test widget lifecycle: register widget → mount in UI → verify bridge communication
- [ ] **Phase 6 E2E** — Test full UX flow: configure API key → install personality → chat with AI → agent hiring

### 2.3 UI Testing
Add browser-based testing for the Office UI.

- [ ] **office-ui** — Set up Playwright for E2E browser tests
- [ ] **office-ui** — Test auth flow (login, register, demo mode)
- [ ] **office-ui** — Test agent creation wizard (select personality, configure, deploy)
- [ ] **office-ui** — Test chat interface (send message, receive streaming response)
- [ ] **office-ui** — Test approval queue (view, approve, deny)
- [ ] **office-ui** — Test responsive layout (mobile, tablet, desktop)

### 2.4 Security Testing
- [ ] **All services** — Add tests verifying unauthenticated requests return 401 — *blocked: `@urule/auth-middleware` falls back to a mock user when JWKS is unreachable, masking 401s in tests; needs a `failClosed` option on the plugin first*
- [x] **All services** — Tests verifying invalid input returns 400 (not 500) — landed in earlier waves (registry/packagehub/mcp-gateway/etc. `routes.test.ts` files exercise Zod 400s)
- [x] **registry, packagehub, mcp-gateway** — CORS validation tests added (`tests/{unit/,}security.test.ts` — preflight from non-allow-listed origin produces no `Access-Control-Allow-Origin`)
- [ ] **All services** — Replace today's `buildCorsApp()` test helpers with tests that import `buildServer()` and exercise the *real* `CORS_ORIGINS` env wiring. Today's tests validate `@fastify/cors` itself, not each service's wiring.
- [x] **Infra** — `npm audit --audit-level=high` step in `.github/workflows/ci.yml` (already landed; warn-only via `continue-on-error: true`)

---

## 3. UX & UI (High)

### 3.1 Error Handling ✅
Replace silent failures and `alert()` calls with proper UI feedback.

- [x] **office-ui** — Toast notification system (success/error/warning/info, auto-dismiss, stacking)
- [x] **office-ui** — React Error Boundaries with dark-themed fallback UI and retry
- [x] **office-ui** — Error feedback on failed API calls (replaced `.catch(() => {})` patterns)
- [x] **office-ui** — Replaced all `alert()` calls with toast notifications
- [ ] **office-ui** — Add network offline detection banner
- [ ] **office-ui** — Add retry buttons on failed data fetches
- [ ] **office-ui** — Handle 401/403 redirects consistently

### 3.2 Accessibility (WCAG 2.1) ✅
- [x] **office-ui** — Semantic landmarks (`<main>`, `<nav>`, `<header>` with roles) in layout
- [x] **office-ui** — ARIA labels on all interactive elements (buttons, inputs, links, modals)
- [x] **office-ui** — `aria-live="polite"` on chat messages, `role="log"` on message container
- [x] **office-ui** — `aria-invalid` + `aria-describedby` for form error states (login, register)
- [x] **office-ui** — `role="tablist/tab/tabpanel"` on agent wizard, `aria-current="step"` on steps
- [x] **office-ui** — `aria-current="page"` on active sidebar nav links
- [ ] **office-ui** — Keyboard navigation for sidebar, modals, and dropdowns
- [ ] **office-ui** — Test with screen reader (VoiceOver/NVDA) and fix issues
- [ ] **office-ui** — Ensure minimum 44px touch targets on mobile

### 3.3 Missing Pages & Flows ✅
- [x] **office-ui** — Implemented `/forgot-password` page (matching login theme, zod validation)
- [x] **office-ui** — Fixed dead link `/office/boards` → `/office/projects`
- [x] **office-ui** — SSO button now shows toast instead of alert
- [ ] **office-ui** — Implement SSO/OAuth login (Google, GitHub — actual integration)
- [ ] **office-ui** — Add email verification flow after registration
- [ ] **office-ui** — Add logout confirmation dialog

### 3.4 Loading States ✅
- [x] **office-ui** — Reusable Skeleton/SkeletonCard/SkeletonList components
- [x] **office-ui** — Skeleton loaders for chat list, agent catalog, dashboard stats, approvals, agent wizard
- [x] **office-ui** — Consistent skeleton pattern replacing all spinner-based loading states

### 3.5 Notification System (partial ✅)
- [x] **office-ui** — Toast notification component (success/error/warning/info) — done in 3.1
- [ ] **office-ui** — Add notification center (bell icon in header with notification history)
- [ ] **office-ui** — Wire approval events to real-time notifications via WebSocket

### 3.6 Theme & Visual ✅
- [x] **office-ui** — Light mode CSS variables + Tailwind mapped to CSS vars
- [x] **office-ui** — Theme toggle in Settings (Dark/Light/System cards)
- [x] **office-ui** — `useThemeStore` with Zustand persist
- [x] **office-ui** — Respects `prefers-color-scheme` via "System" option
- [x] **office-ui** — Flash-free theme init via inline script before hydration

### 3.7 Mobile UX ✅
- [x] **office-ui** — Collapsible sidebar with hamburger menu (`useSidebarStore`)
- [x] **office-ui** — Overlay backdrop on mobile, auto-close on nav link click
- [x] **office-ui** — Agent wizard: full-screen modal, stacked fields, compact step bar
- [x] **office-ui** — Chat: fixed input above keyboard, horizontal-scroll action pills
- [ ] **office-ui** — Add bottom navigation bar for mobile

---

## 4. Infrastructure (Medium)

### 4.1 Database Migrations
Replace fragile init scripts with proper versioned migrations.

- [ ] **registry** — Generate Drizzle migration files from schema (currently empty `migrations/` dir)
- [ ] **packagehub** — Generate Drizzle migration files
- [ ] **mcp-gateway** — Generate Drizzle migration files
- [ ] **infra** — Document migration strategy (how to apply, rollback, test)
- [ ] **infra** — Add migration step to Docker Compose startup

### 4.2 Docker Improvements ✅
- [x] **All 12 Dockerfiles** — Added `HEALTHCHECK` instruction
- [x] **All services in compose** — `restart: unless-stopped` policy
- [x] **All services in compose** — Memory/CPU resource limits (512M services, 1G postgres, 256M nats)
- [ ] **All services in compose** — Configure log rotation (`max-size`, `max-file`)
- [ ] **infra compose** — Add health checks for Temporal, Keycloak, OpenFGA, OPA

### 4.3 Structured Logging ✅
- [x] **All 11 services** — Enhanced Pino config with `LOG_LEVEL` env var, custom request serializer
- [x] **All services** — Request IDs via `crypto.randomUUID()` on every request
- [x] **All 4 error handlers** — Log errors with full context (err object, requestId, stack trace)
- [ ] **All services** — Add correlation ID propagation across service boundaries

### 4.4 OpenTelemetry & Tracing
- [ ] **registry** — Add `@opentelemetry/sdk-node` instrumentation (telemetry dir exists but is empty)
- [ ] **All services** — Add OTEL trace/span generation for HTTP requests
- [ ] **All services** — Add OTEL trace propagation for cross-service calls
- [ ] **infra** — Verify OTEL Collector → Jaeger pipeline receives data

### 4.5 Database Performance ✅
- [x] **registry** — Indexes on agents(workspaceId, status), workspaces(orgId, slug), runtimes, providers, conversations
- [x] **packagehub** — Indexes on packages(name, type), versions(packageId)
- [x] **mcp-gateway** — Indexes on servers(name), bindings(workspaceId), tools(serverId)
- [x] **registry + mcp-gateway** — Pagination (limit/offset) on 5 list endpoints

### 4.6 Graceful Shutdown ✅
- [x] **All 11 services** — SIGTERM/SIGINT handlers calling `app.close()` + `process.exit(0)`
- [ ] **langgraph-adapter** — Close WebSocket connections on shutdown
- [ ] **state** — Flush NATS KV state before shutdown

---

## 5. Developer Experience (Medium)

### 5.1 Monorepo Tooling ✅
- [x] **urule** — Root `package.json` with npm workspaces (`packages/*`, `services/*`, `plugins/*`, `apps/*`)
- [x] **urule** — `npm run test:all`, `build:all`, `lint:all`, `typecheck:all` commands
- [ ] **urule** — Consider Turborepo for incremental builds and caching

### 5.2 Shared Configurations ✅
- [x] **urule** — `tsconfig.base.json` shared TypeScript config
- [x] **urule** — `.eslintrc.json` shared ESLint config
- [x] **urule** — `.prettierrc` shared Prettier config
- [x] **urule** — `.nvmrc` pinned to Node 20

### 5.3 Dependency Alignment ✅
- [x] **All packages** — TypeScript aligned to `^5.5.0`
- [x] **All packages** — Vitest aligned to `^2.0.0`
- [x] **All packages** — Fastify aligned to `^5.0.0`

### 5.4 CI/CD Pipeline ✅
- [x] **urule** — GitHub Actions: lint + typecheck, test, security audit, Docker validation
- [x] **urule** — Issue templates (bug report, feature request)
- [x] **urule** — PR template with testing checklist
- [ ] **urule** — Docker image build + push to GHCR on tag
- [x] **All standalone repos** — CI workflows already configured

### 5.5 API Documentation ✅
- [x] **All 11 services** — `@fastify/swagger` + `@fastify/swagger-ui` with OpenAPI 3.0 specs
- [x] **All services** — Swagger UI at `/docs` (public, no auth required)
- [x] **All services** — Service-specific titles, descriptions, and tags
- [ ] **All services** — Add route-level JSDoc/schema annotations for richer docs
- [ ] **Libraries** — Add TypeDoc for auto-generated type documentation

### 5.6 Developer Setup ✅
- [x] **urule** — `scripts/dev-setup.sh` with prerequisite checks and guided setup
- [x] **urule** — `Makefile` with `make dev`, `make test`, `make build`, `make infra-up/down`, `make e2e`, `make clean`
- [x] **urule** — `scripts/clone-all.sh` clones all standalone repos

---

## 6. Features (Low)

### 6.1 Widget System
- [ ] **widget-sdk** — Add widget configuration persistence (save widget settings)
- [ ] **widget-sdk** — Add widget-to-widget communication protocol
- [ ] **office-ui** — Make widgets truly modular (currently most are page re-exports)
- [ ] **office-ui** — Add widget drag-and-drop customization in dashboard
- [ ] **office-ui** — Add widget marketplace UI (browse, install, configure)

### 6.2 Agent Capabilities
- [ ] **registry** — Implement agent memory storage (currently returns empty arrays)
- [ ] **registry** — Implement real agent metrics (currently returns hardcoded zeros)
- [ ] **registry** — Implement real agent health checks (currently hardcoded)
- [ ] **langgraph-adapter** — Add support for multiple AI providers (OpenAI, Gemini, local models)
- [ ] **langgraph-adapter** — Add conversation branching/forking
- [ ] **langgraph-adapter** — Fix `pauseForApproval` ID mismatch: `pendingApprovals.push(ulid())` generates a fresh ID, but `resumeRun(input.approvalId)` filters by that exact ID, so the filter never matches. Use the approval's actual ID (`_approval.id`) when one is supplied.
- [ ] **orchestrator-contract** — Add adapter implementations for CrewAI, AutoGen, ADK
- [ ] **governance** — Replace `(request as any)`, `(decision as any)` casts in `src/routes/governance.routes.ts` with proper types matching the adapter contracts. Project ESLint warns on `@typescript-eslint/no-explicit-any`.
- [ ] **governance** — Audit emit failures in `governance.routes.ts` are silenced with `.catch(() => {})`. Either log them at warn level or push to a dead-letter topic so they're visible.

### 6.3 Package Ecosystem
- [ ] **packagehub** — Add package ratings and reviews
- [ ] **packagehub** — Add package dependency resolution (display dependency tree)
- [ ] **packages** — Add package auto-update notifications
- [ ] **packages** — Add rollback capability for package upgrades

### 6.4 Collaboration
- [ ] **state** — Implement real-time collaborative editing (CRDT or OT)
- [ ] **state** — Add typing indicators for chat
- [ ] **channel-router** — Add email channel adapter
- [ ] **channel-router** — Add Discord channel adapter
- [ ] **channel-router** — Add Microsoft Teams channel adapter

### 6.5 Office UI Features
- [ ] **office-ui** — Add data export/download for lists (CSV, JSON)
- [ ] **office-ui** — Add form draft auto-save
- [ ] **office-ui** — Add undo/redo for form editing
- [ ] **office-ui** — Add keyboard shortcuts (Cmd+K command palette)
- [ ] **office-ui** — Add user preferences store (layout, filters, favorites)
- [ ] **office-ui** — Add real-time notification sounds (configurable)

### 6.6 Operations
- [ ] **infra** — Add Prometheus metrics collection
- [ ] **infra** — Add Grafana dashboards for service monitoring
- [ ] **infra** — Create deployment guide (production setup)
- [ ] **infra** — Create backup/recovery documentation
- [ ] **infra** — Add Helm charts for Kubernetes deployment

---

## Summary

| Category | Priority | Items | Affects |
|----------|----------|-------|---------|
| Security | Critical | 25+ | All services |
| Testing | High | 20+ | All repos |
| UX & UI | High | 25+ | office-ui |
| Infrastructure | Medium | 20+ | All services, infra |
| Developer Experience | Medium | 20+ | All repos |
| Features | Low | 25+ | Various |

**Total: ~140 improvement items**

---

*Last updated: 2026-04-29*
