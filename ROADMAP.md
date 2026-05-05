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
Replace `origin: true` (allow all) with explicit origin whitelist. All 10 services that office-ui calls from the browser ([apps/office-ui/src/lib/api.ts](apps/office-ui/src/lib/api.ts) `SERVICE_URLS` map) now register `@fastify/cors` with `process.env.CORS_ORIGINS` (comma-split, defaults to `http://localhost:3000`). The backstage plugin is intentionally excluded — it's a backend-to-Backstage sync, not browser-facing.

- [x] **registry, packagehub, state, langgraph-adapter, approvals** — Original wave (configurable via `CORS_ORIGINS`).
- [x] **governance, packages, mcp-gateway, channel-router, runtime-broker** — Added in expansion wave: same canonical pattern, `@fastify/cors` dep added to each `package.json` (mcp-gateway already had it). Without this, browser preflight from a non-localhost origin would have produced no `Access-Control-Allow-Origin` header in production and the UI couldn't have called these services.

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
- [x] **state, governance, approvals, channel-router, langgraph-adapter, runtime-broker** — Extended fail-fast pattern to remaining 6 services. `validateConfig()` in each now throws on missing `NATS_URL` (and `TEMPORAL_ADDRESS` for approvals, `REGISTRY_URL` for langgraph-adapter); governance keeps `OPENFGA_STORE_ID` warn-only since dev setups intentionally skip authz. Each service has a `tests/config.test.ts` covering missing/present cases (+14 tests total).
- [x] **registry, packagehub, governance, mcp-gateway** — Lifted `redactSecrets` into `@urule/events` (`src/redaction/redact-secrets.ts`) with 9 unit tests. All four services' `src/middleware/error-handler.ts` now redact `error.message` and `error.stack` before logging *and* before returning to the client. langgraph-adapter switched from its local copy to the shared util; its duplicate tests were removed (the canonical tests live in `@urule/events`).

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

- [x] **Phase 2 E2E** — [infra/e2e/phase2.test.mjs](infra/e2e/phase2.test.mjs). Publishes a package to PackageHub (with rejected duplicate), publishes a version, browses for it, fetches by name and by name+version, then installs via the packages service into a workspace, lists installations, rejects duplicate install, fetches by id, uninstalls, verifies 404 on subsequent fetch.
- [x] **Phase 3 E2E** — [infra/e2e/phase3.test.mjs](infra/e2e/phase3.test.mjs). Exercises every approval transition: approve, deny, reject (terminal), cancel (requester withdraws), and escalate (priority bump). Creates an approval rule first to verify rule routing. Final list endpoint verifies all 5 approvals with correct statuses.
- [x] **Phase 4 E2E** — [infra/e2e/phase4.test.mjs](infra/e2e/phase4.test.mjs). State service: room create + task create + agent assignment + status update + cleanup. Channel-router: binding create + slack-shaped inbound webhook normalization + identity-mapping create/lookup + cleanup. Tolerant of impl variation (PATCH vs POST for task status, list vs object response shapes) so it doesn't break on response-shape evolution.
- [x] **Phase 5 E2E** — Widget lifecycle covered by [office-ui/e2e/widgets.spec.ts](apps/office-ui/e2e/widgets.spec.ts) under the §2.3 Playwright suite (built-in widget mounting + bridge contract + error-boundary). Browser-side, not a backend HTTP flow.
- [ ] **Phase 6 E2E** — Chat-with-AI flow needs an Anthropic API key + outbound network access; not appropriate for a CI E2E. Phase 1's run lifecycle + the langgraph-adapter unit tests cover the orchestrator boundary; the configure-API-key + install-personality parts are already exercised by Phase 2.

Shared helpers live in [infra/e2e/lib.mjs](infra/e2e/lib.mjs) (assert / test / post / get / del / patch / waitForService / summary). [infra/e2e/run-all.mjs](infra/e2e/run-all.mjs) chains phases 1-4; honors `PHASE=N` to scope to a single phase. The Dockerfile copies all four phase files + helpers and defaults to running them all on container start.

### 2.3 UI Testing ✅
Browser-based testing for the Office UI. Playwright suite at [apps/office-ui/e2e/](apps/office-ui/e2e/) — 16 spec files, ~700 lines, organised by user journey. Authenticated tests use the [fixtures/auth.ts](apps/office-ui/e2e/fixtures/auth.ts) helper.

- [x] **office-ui** — Playwright set up. `@playwright/test ^1.48.0` in devDeps; `npm run e2e`, `e2e:ui`, `e2e:headed`, `e2e:report` scripts in package.json.
- [x] **office-ui** — Auth flow ([e2e/auth.spec.ts](apps/office-ui/e2e/auth.spec.ts)). Login page renders, validation errors fire on empty submission, invalid credentials produce server error (502 if Keycloak down), demo-mode flow.
- [x] **office-ui** — Agent management ([e2e/agents.spec.ts](apps/office-ui/e2e/agents.spec.ts)). Browse list, search, category filters; agent creation wizard surface verified.
- [x] **office-ui** — Chat interface ([e2e/chat.spec.ts](apps/office-ui/e2e/chat.spec.ts)). Conversation list filter tabs, new-chat button, conversation routing.
- [x] **office-ui** — Approval queue ([e2e/approvals.spec.ts](apps/office-ui/e2e/approvals.spec.ts)). Status filter tabs (Pending/Approved/Rejected), skeleton-loading transition.
- [x] **office-ui** — Responsive layout ([e2e/responsive.spec.ts](apps/office-ui/e2e/responsive.spec.ts)). Mobile hamburger menu, tablet/desktop sidebar visibility, viewport-driven layout shifts.
- [x] **office-ui** — Widget lifecycle ([e2e/widgets.spec.ts](apps/office-ui/e2e/widgets.spec.ts)). Built-in widget mounting (approval-queue, dashboard-stats, chat-list), widget bridge contract smoke (host shell persists across navigation), error-boundary smoke (single failing widget doesn't crash the page). Closes Phase 5 from §2.2.

Adjacent specs covering the rest of the office-ui surface, also part of this suite: dashboard, onboarding, projects, workspaces, settings, theme, integrations, logs, security, accessibility — for ~16 spec files total.

### 2.4 Security Testing
- [x] **All services** — Each of the 11 services now has `tests/auth-401.test.ts` (registry's lives in `tests/unit/`) that registers `@urule/auth-middleware` with `failClosed: true` + an unreachable `jwksUrl` and the same `publicRoutes` list as production, then asserts: (a) unauthenticated requests to a representative protected route return 401, (b) `/healthz` and `/docs/*` remain 200, (c) any service-specific public prefix (`/api/v1/infrastructure` and `/auth/login` for registry, `/api/v1/packages` for packagehub, `/api/v1/channels` for channel-router) also remains 200. The publicRoutes list is duplicated from server.ts deliberately so config drift in either direction shows up as a test failure.
- [x] **All services** — Tests verifying invalid input returns 400 (not 500) — landed in earlier waves (registry/packagehub/mcp-gateway/etc. `routes.test.ts` files exercise Zod 400s)
- [x] **registry, packagehub, mcp-gateway** — CORS validation tests added (`tests/{unit/,}security.test.ts` — preflight from non-allow-listed origin produces no `Access-Control-Allow-Origin`)
- [x] **All services** — Replaced today's `buildCorsApp()` test helpers (registry/packagehub/mcp-gateway) with tests that import `buildServer()` and exercise the real `process.env.CORS_ORIGINS` wiring; added equivalent `tests/cors.test.ts` to the seven services that lacked any CORS test (state, langgraph-adapter, approvals, governance, packages, channel-router, runtime-broker). Each suite asserts: first allow-listed origin echoed, second comma-separated origin echoed (proves the comma split), non-allow-listed origin rejected, and the unset-env fallback to `http://localhost:3000`. A typo like `CORS_ORIGIN` (singular) in the service code would now fail tests.
- [x] **Infra** — `npm audit --audit-level=high` step in `.github/workflows/ci.yml` (already landed; warn-only via `continue-on-error: true`)

---

## 3. UX & UI (High)

### 3.1 Error Handling ✅
Replace silent failures and `alert()` calls with proper UI feedback.

- [x] **office-ui** — Toast notification system (success/error/warning/info, auto-dismiss, stacking)
- [x] **office-ui** — React Error Boundaries with dark-themed fallback UI and retry
- [x] **office-ui** — Error feedback on failed API calls (replaced `.catch(() => {})` patterns)
- [x] **office-ui** — Replaced all `alert()` calls with toast notifications
- [x] **office-ui** — Network offline detection banner. New [hooks/useOnlineStatus.ts](apps/office-ui/src/hooks/useOnlineStatus.ts) (`navigator.onLine` + `online`/`offline` event subscription + 5s polling fallback for browsers that miss events; visibility-aware so it stops polling when the tab is hidden) and [components/layout/OfflineBanner.tsx](apps/office-ui/src/components/layout/OfflineBanner.tsx) (sticky top banner with `role="status" aria-live="polite"`; slides in/out via CSS transform). Mounted globally in [office/layout.tsx](apps/office-ui/src/app/office/layout.tsx). Test-id `offline-banner` for Playwright.
- [ ] **office-ui** — Retry buttons on failed data fetches. Needs an audit of every React Query hook + each list page's error state UI; defer until all the data-fetching surfaces have shipped (some §6.x features still in-flight).
- [ ] **office-ui** — Handle 401/403 redirects consistently

### 3.2 Accessibility (WCAG 2.1) ✅
- [x] **office-ui** — Semantic landmarks (`<main>`, `<nav>`, `<header>` with roles) in layout
- [x] **office-ui** — ARIA labels on all interactive elements (buttons, inputs, links, modals)
- [x] **office-ui** — `aria-live="polite"` on chat messages, `role="log"` on message container
- [x] **office-ui** — `aria-invalid` + `aria-describedby` for form error states (login, register)
- [x] **office-ui** — `role="tablist/tab/tabpanel"` on agent wizard, `aria-current="step"` on steps
- [x] **office-ui** — `aria-current="page"` on active sidebar nav links
- [x] **office-ui** — Keyboard navigation for modals + dropdowns. New [lib/focusTrap.ts](apps/office-ui/src/lib/focusTrap.ts) helper installs a Tab/Shift+Tab handler that bounces focus inside a container's focusable descendants; modal components opt in via `useEffect`. Two-button modals (e.g. [ConfirmDialog](apps/office-ui/src/components/ui/ConfirmDialog.tsx)) use an inline trap (Tab cycles between cancel↔confirm). [CommandPalette](apps/office-ui/src/components/layout/CommandPalette.tsx) handles ↑↓/Enter/Esc inline (already shipped in §6.5); the trap utility is the reusable primitive for future modals. Sidebar collapse / hamburger were already keyboard-reachable from §3.2's first wave.
- [ ] **office-ui** — Test with screen reader (VoiceOver/NVDA) and fix issues. Manual QA — defer.
- [ ] **office-ui** — Ensure minimum 44px touch targets on mobile

### 3.3 Missing Pages & Flows ✅
- [x] **office-ui** — Implemented `/forgot-password` page (matching login theme, zod validation)
- [x] **office-ui** — Fixed dead link `/office/boards` → `/office/projects`
- [x] **office-ui** — SSO button now shows toast instead of alert
- [ ] **office-ui** — Implement SSO/OAuth login (Google, GitHub — actual integration). Needs Keycloak realm config + provider client IDs/secrets; out of scope for a pure-frontend iteration.
- [ ] **office-ui** — Email verification flow after registration. Needs Keycloak's "Verify Email" required-action + an SMTP relay; same blocker as SSO.
- [x] **office-ui** — Logout confirmation dialog. New [components/ui/ConfirmDialog.tsx](apps/office-ui/src/components/ui/ConfirmDialog.tsx) — modal with title + description + cancel/confirm buttons, configurable `variant` (`destructive` paints confirm red), Escape cancels, Tab cycles between buttons (focus trap), backdrop-click cancels, autofocus on confirm so a quick Enter accepts the default. Wired into the Cmd+K palette's "Sign out" command — instead of immediate logout, opens the confirm with destructive styling. Reusable for future destructive actions (delete agent, uninstall package, revoke entitlement).

### 3.4 Loading States ✅
- [x] **office-ui** — Reusable Skeleton/SkeletonCard/SkeletonList components
- [x] **office-ui** — Skeleton loaders for chat list, agent catalog, dashboard stats, approvals, agent wizard
- [x] **office-ui** — Consistent skeleton pattern replacing all spinner-based loading states

### 3.5 Notification System (partial ✅)
- [x] **office-ui** — Toast notification component (success/error/warning/info) — done in 3.1
- [x] **office-ui** — Notification center (bell icon in header with notification history). New [store/useNotificationCenterStore.ts](apps/office-ui/src/store/useNotificationCenterStore.ts) (zustand+persist, namespace `urule-notification-center`, capped at 100 entries to keep localStorage bounded; per-entry kind/title/body/createdAt/read/href/source). New [components/layout/NotificationCenter.tsx](apps/office-ui/src/components/layout/NotificationCenter.tsx) — popover anchored to a bell button, listed newest-first, click to mark-read + route to `href` if set, mark-all-read + clear-all top-bar actions, hover-revealed dismiss button per entry, unread badge on the bell with `99+` overflow. New [hooks/useNotificationCapture.ts](apps/office-ui/src/hooks/useNotificationCapture.ts) mirrors every toast into the center so a user who missed the auto-dismissed toast can read it later. AppHeader's stub bell button replaced with `<NotificationBell>`; the center is mounted globally in office layout. Playwright spec [e2e/notification-center.spec.ts](apps/office-ui/e2e/notification-center.spec.ts) (5 specs) covers bell visibility, toggle, Escape close, empty state, seeded notification rendering, and clear-all.
- [ ] **office-ui** — Wire approval events to real-time notifications via WebSocket. The data plumbing is ready (`add()` accepts an `href` deep-link + `source: 'approval'`); needs a backend channel — either langgraph-adapter's existing WebSocket route extended with approval events, or a fresh notifications service that subscribes to `urule.approvals.*` NATS topics and pushes to authenticated clients. Defer until a concrete user pull (today's polling-based approval queue UX is fine for the demo flow).

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

### 4.1 Database Migrations ✅
Replace fragile init scripts with proper versioned migrations.

- [x] **registry** — Generated `migrations/0000_brave_silver_surfer.sql` from the existing `src/db/schema/*.ts` files. drizzle-kit was bumped 0.24→0.31 and drizzle-orm 0.33→0.45 to make `db:generate` work; `drizzle.config.ts` at the service root drives both `db:generate` and `db:migrate`.
- [x] **packagehub** — Generated `migrations/0000_tense_frank_castle.sql` (packages + package_versions tables) the same way. Added `0001_pg_trgm.sql` (custom migration via `drizzle-kit generate --custom`) to capture the `pg_trgm` extension that the retired init script used to install for trigram-based search.
- [x] **mcp-gateway** — Generated `migrations/0000_damp_eddie_brock.sql` (mcp_servers + workspace_bindings + tools). Added `db:generate` and `db:migrate` to package.json (registry/packagehub already had them).
- [x] **infra** — Documented in [docs/MIGRATIONS.md](docs/MIGRATIONS.md): generation, application, rollback (forward-only — write a new migration that undoes the previous), testing, and the upgrade path from legacy init-script-bootstrapped DBs (drop volume *or* manually seed `drizzle.__drizzle_migrations`).
- [x] **infra** — Wired migrations as one-shot Compose services. New `migrator` multi-stage target in [services/registry/Dockerfile](services/registry/Dockerfile), [services/packagehub/Dockerfile](services/packagehub/Dockerfile), and [mcp-gateway/Dockerfile](../mcp-gateway/Dockerfile) ships drizzle-kit + the migrations dir + drizzle.config.ts and runs `npx drizzle-kit migrate`. New `registry-migrate` service in phase1.yaml + phase6.yaml, plus `packagehub-migrate` in phase6.yaml; long-running services depend on them via `service_completed_successfully`. Seed scripts (`seed-registry.sql`, `seed-packagehub.sql`) moved out of `docker-entrypoint-initdb.d` into one-shot `*-seed` services that run after each migrator (idempotent — `INSERT ... ON CONFLICT DO NOTHING`). Retired `init-registry-schema.sh` and `init-packagehub-schema.sh`. The `init-db.sql` (per-service `CREATE DATABASE`) stays — it's database creation, not schema, and doesn't belong in a migration. Compose configs validate (`docker compose config` clean for both phase1 and phase6). **Caveat**: live `docker compose build` of any image (existing `runner` stage and the new `migrator` stage alike) currently fails because the per-service `package-lock.json` files are stale and don't include the workspace deps (`@urule/auth-middleware`, `@urule/correlation-id`, `@urule/events`) that have been added to the service `package.json` files since the locks were last regenerated; `npm ci` then 404s on the registry workspace names. This is a pre-existing problem (the runner build was already broken before this work) and warrants its own ROADMAP item — see §5.x below.

### 4.1.1 Workspace deps in production Docker builds ✅
- [x] **infra (monorepo services)** — Pattern A: widened `build.context` to urule monorepo root for the 4 services in phase6 (registry, packagehub, state, office-ui). Each Dockerfile copies all workspace `package.json` files first, runs `npm ci` once at the workspace root, then builds the target workspace via `npm run build -w @urule/<service>`. Builder stage uses full devDeps; runner stage does its own `npm ci -w <svc> --omit=dev --include-workspace-root`. Migrator stage extends `deps` (full install) for direct drizzle-kit access. Compose contexts updated from `../../services/<x>` → `../..` with `dockerfile: services/<x>/Dockerfile`. Live-validated end-to-end: `registry-migrate` creates all 10 tables, `packagehub-migrate` creates 2 tables + the `pg_trgm` extension via the new 0001 migration, `*-seed` services populate 1 demo org + 27 demo packages, idempotent re-runs are no-ops.
- [x] **infra (standalones)** — Pattern B: widened `build.context` to `urule-repos/` (parent of urule and standalones) for langgraph-adapter and approvals. Their Dockerfiles COPY pre-built `dist/` of the consumed `@urule/*` packages directly (referenced via `file:` paths in package.json that resolve in-context). Pre-build at the host (`npm --prefix urule run build:all` + `npm --prefix orchestrator-contract run build`) is now a documented prerequisite for `docker compose build`. orchestrator-adapters happens to be its own npm workspace, so its Dockerfile reproduces enough of that workspace inside the image to let `npm ci` resolve the workspace tree.
- [x] **infra (.dockerignore)** — Added [urule/.dockerignore](.dockerignore) excluding `node_modules`, `*.tsbuildinfo`, `tests/`, `e2e/`, `*.test.ts`, `coverage/` etc. Keeps the monorepo build context lean (otherwise it ships the whole tree on every layer change).
- [x] **infra (remaining)** — channel-router, runtime-broker, mcp-gateway now in `docker-compose.phase6.yaml` with Pattern B Dockerfiles (`build.context: ../../..`). Each declares its OTel + prom-client deps directly in `package.json` rather than relying on `@urule/observability`'s transitive deps — Node ESM module resolution for file:-linked workspace packages walks up from the symlink target (not the linker), so transitives aren't found at the consumer level otherwise. Dockerfiles use `npm ci --install-links` so file:-linked packages are *copied* into node_modules (not symlinked), which lets npm resolve the dependency tree the way runtime expects. Lockfiles regenerated with `--install-links` to match. mcp-gateway also has a one-shot `mcp-gateway-migrate` Compose service (its drizzle schema). Live-validated end-to-end: all three build via `docker compose build`, come up healthy, expose `/metrics`, and Prometheus scrapes them as `up` targets.

### 4.2 Docker Improvements ✅
- [x] **All 12 Dockerfiles** — Added `HEALTHCHECK` instruction
- [x] **All services in compose** — `restart: unless-stopped` policy
- [x] **All services in compose** — Memory/CPU resource limits (512M services, 1G postgres, 256M nats)
- [x] **All services in compose** — Configured `json-file` log rotation with `max-size: 10m` / `max-file: 3` across `docker-compose.{infra,phase1,phase6}.yaml`. Each file declares its own `x-default-logging` anchor (compose `include:` doesn't propagate YAML anchors across files) and every service references it via `logging: *default-logging`. Validated with `docker compose config` on all three files.
- [x] **infra compose** — Added healthchecks to Temporal (via bundled `tctl namespace list`), Keycloak (`KC_HEALTH_ENABLED=true` exposes `/health/ready` on port 9000, with a fallback to `/` on 8080 for older builds), OpenFGA (`/healthz` on 8080) and OPA (`/health` on 8181). Devtools (otel-collector, jaeger) intentionally left without checks.

### 4.3 Structured Logging ✅
- [x] **All 11 services** — Enhanced Pino config with `LOG_LEVEL` env var, custom request serializer
- [x] **All services** — Request IDs via `crypto.randomUUID()` on every request
- [x] **All 4 error handlers** — Log errors with full context (err object, requestId, stack trace)
- [x] **All 10 services** — Correlation ID propagation across service boundaries. New `@urule/correlation-id` workspace package wraps a Fastify plugin (registered first, before CORS) that reads `x-correlation-id` from inbound headers, mints a ULID when absent, echoes it back on the response, overrides `request.id` (so pino auto-tags every log line), and stores it in `AsyncLocalStorage` so any code path can call `getCorrelationId()` zero-arg. Outbound calls use a `fetchWithCorrelation()` wrapper that injects the header from ALS — applied to the registry→adapter call site and all 16 in-ecosystem fetch sites in `langgraph-adapter`'s `anthropic-executor.ts` (external Keycloak/OPA/OpenFGA/manifest-loader calls intentionally left on plain `fetch`). `@urule/events` `EventBus.publish()` sets the header on the NATS message and falls back to ALS when no explicit `correlationId` is passed; `subscribe()` and `subscribeDurable()` re-establish the ALS context before invoking the handler so cascaded fetches in event consumers inherit the same ID. `office-ui`'s axios interceptor mints `x-correlation-id` per browser request so a user click is the actual root of the trace. New tests: `urule/packages/correlation-id/tests/plugin.test.ts` (11 tests covering inbound passthrough, mint-on-absent, ALS no-leak across parallel injections, fetch wrapper override behaviour), `event-bus-correlation.test.ts` (5 tests covering NATS roundtrip), and `tests/correlation-id.test.ts` per service (2 tests × 10 services).

### 4.4 OpenTelemetry & Tracing ✅
- [x] **registry** (and all services) — `@opentelemetry/sdk-node` instrumentation shipped via the new `@urule/observability` package's `initOtel(serviceName)` helper. Wired into every service's `package.json`. The auto-instrumentations cover HTTP servers + clients, `pg`, `dns`, `net` automatically — no manual span code required for the HTTP boundary.
- [x] **All services** — HTTP trace/span generation: covered automatically by `@opentelemetry/auto-instrumentations-node` once `initOtel()` is called.
- [x] **All services** — Cross-service propagation via W3C `traceparent`: also automatic with auto-instrumentation. Combined with the §4.3 `x-correlation-id` propagation, both human-friendly and trace-ID-shaped IDs flow end-to-end.
- [x] **All 10 services** — `initOtel(serviceName)` wired into each `src/index.ts`. Pattern: only `import { initOtel } from '@urule/observability';` is static (ESM imports are hoisted; SDK must start before Fastify resolves so auto-instrumentation can patch it). Everything else (`./config.js`, `./server.js`, etc.) is loaded via top-level `await import(...)` after `initOtel()` returns. SIGTERM/SIGINT handlers updated to call `await otelSdk?.shutdown()` so in-flight spans flush before container exit.
- [x] **infra** — OTEL Collector → Jaeger pipeline now flowing data end-to-end. Caught a config issue: the original [otel-collector-config.yaml](infra/compose/otel-collector-config.yaml) used the legacy `jaeger:14250` (jaeger.api_v2.CollectorService) endpoint, which modern jaeger releases removed in favour of OTLP-on-4317. Updated the `otlp/jaeger` exporter to point at `jaeger:4317`. Live-validated: registry traces visible in Jaeger UI at `localhost:16686`; service appears in `/api/services`; multiple GET spans returned by `/api/traces?service=registry`.

### 4.5 Database Performance ✅
- [x] **registry** — Indexes on agents(workspaceId, status), workspaces(orgId, slug), runtimes, providers, conversations
- [x] **packagehub** — Indexes on packages(name, type), versions(packageId)
- [x] **mcp-gateway** — Indexes on servers(name), bindings(workspaceId), tools(serverId)
- [x] **registry + mcp-gateway** — Pagination (limit/offset) on 5 list endpoints

### 4.6 Graceful Shutdown ✅
- [x] **All 11 services** — SIGTERM/SIGINT handlers calling `app.close()` + `process.exit(0)`
- [x] **langgraph-adapter** — Close WebSocket connections on shutdown. New `closeAllConnections()` in `src/routes/ws.routes.ts` walks the conversation→sockets map and sends a 1001 ("going away") close frame to every open client. The SIGTERM/SIGINT handler in `src/index.ts` now calls it (logging the closed count) before `app.close()`, so clients see an immediate disconnect instead of waiting for a TCP timeout.
- [ ] ~~**state** — Flush NATS KV state before shutdown~~ — N/A: the state service is currently in-memory only (`Map`-backed managers in `src/services/`); the CLAUDE.md description is aspirational. If/when state is migrated to NATS KV, the shutdown handler will need to flush. Tracked as part of that future migration, not as a graceful-shutdown gap.

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
- [x] **urule** — Docker image build + push to GHCR on `v*` tag (matrix: registry, packagehub, state, office-ui). Uses `docker/build-push-action@v6` with GHA cache, `docker/metadata-action@v5` for semver+latest tagging. Builds `ghcr.io/urule-ai/<service>:<tag>` plus `:major.minor` and `:latest`.
- [x] **approvals, orchestrator-adapters (langgraph)** — Pattern B: GHA workflow checks out urule (and orchestrator-contract for langgraph) alongside the standalone, runs `npm run build:all` host-side to populate `dist/`, then `docker build` with parent-of-both as build context. Triggered on `v*` tag in the standalone repo.
- [x] **All standalone repos** — CI workflows already configured for build+test
- [x] **channel-router, runtime-broker, mcp-gateway** — docker-publish workflows shipped in each repo's `.github/workflows/ci.yml`. Pattern B style: triggered on `v*` tag, checks out urule alongside the standalone, runs `npm --prefix urule run build:all` to populate workspace dist/, then docker-builds with `context: .` and `dockerfile: <repo>/Dockerfile`. Pushes `ghcr.io/urule-ai/{channel-router,runtime-broker,mcp-gateway}:<tag>` plus `:major.minor` and `:latest`. Build-and-test job also updated to use `--install-links` and clone urule for workspace deps.

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
- [x] **registry** — Implemented agent memory storage. New `agent_memories` table (id ULID, agent_id FK→agents ON DELETE CASCADE, content text ≤10000, kind varchar default 'note', tags jsonb default [], created_at). Drizzle migration `0001_agent_memories.sql` generated. GET / POST / DELETE handlers with Zod validation, 404 on missing agent or memory, pagination via `limit`/`offset` (max 100). Replaces the 3 stub handlers in `agents.routes.ts`.
- [x] **registry** — Implemented real agent metrics derived from `messages` and `conversation_agents` source-of-truth. `GET /agents/:id/metrics` returns `messages_sent`, `messages_sent_24h`, `conversations_participated`, `last_active`. CPU/memory fields kept at 0 with a comment — agents are logical actors, not OS processes; surfacing fake numbers was misleading. New `messages_sender_id_idx` (sender_id, sender_type) index supports the aggregate queries. Returns 404 for unknown agentId. `tasks_completed`/`tasks_in_progress` removed — those live in state service; if office-ui needs them it should call state directly.
- [x] **registry** — Implemented real agent health checks. `GET /agents/:id/health` derives `status` from message activity: `'healthy'` (<5min), `'idle'` (<30min), `'stale'` (>30min), `'never_active'` (no messages ever). `last_heartbeat` is the most recent message timestamp. Same memory/CPU caveat as metrics. Returns 404 for unknown agentId.
- [ ] **langgraph-adapter** — Add support for multiple AI providers (OpenAI, Gemini, local models)
- [ ] **langgraph-adapter** — Add conversation branching/forking
- [x] **orchestrator-contract + adapters** — Fixed `pauseForApproval` ID mismatch. `ApprovalRequest` now carries an optional `id`; both langgraph-adapter and goose-adapter (and the contract's mock-adapter) use it when provided so `resumeRun({approvalId})` can target a specific pending approval. Compliance suite extended with a roundtrip test.
- [ ] **orchestrator-adapters** — Add CrewAI, AutoGen, and ADK adapters as new workspace packages in the [orchestrator-adapters](https://github.com/urule-ai/orchestrator-adapters) monorepo (alongside `goose-adapter` and `langgraph-adapter`). Each new adapter implements `OrchestratorAdapter` from `@urule/orchestrator-contract` and runs its compliance suite.
- [x] **governance** — Removed all `(request as any)`/`(decision as any)`/`(result as any)` casts in `src/routes/governance.routes.ts`. Request user access goes through a typed `getUser()` helper that mirrors auth-middleware's intersection-cast pattern with the exported `UruleUser` type. The decide/policy/authz return values are now read via their typed `.allowed` field directly. As a side effect, the audit log message for `/decide` now correctly shows `"allowed"`/`"denied"` (previously always `"evaluated"` because the cast hid that the return shape has no `.decision` field).
- [x] **governance** — Audit emit failures are no longer silenced. Each `.catch(() => {})` now logs at `request.log.warn` with the route name and underlying error, so emit failures show up in service logs alongside the request that caused them.

### 6.3 Package Ecosystem
- [x] **packagehub** — Cryptographic package signing. New `publisher_pubkey` + `pubkey_kind` columns on `packages`; `signature` + `signature_kind` + `signed_at` on `package_versions`. Verifier in [services/packagehub/src/services/signing.ts](services/packagehub/src/services/signing.ts) uses Node built-in `crypto.verify(null, digest, pubkey, sig)` against an Ed25519 SPKI-wrapped raw 32-byte key — no external deps. Canonical digest: `SHA256(JSON.stringify(manifest, sortedKeys) || readme || version)`. Once a package is published with a publisher pubkey, every subsequent version publish must carry a signature that verifies against it (400 SIGNATURE_REQUIRED if missing, 401 SIGNATURE_INVALID if wrong). Anonymous packages stay unsigned for back-compat. New `GET /api/v1/packages/:name/versions/:version/verify` endpoint for consumers to sanity-check before installing. **Why Ed25519 first** (vs GitHub Sigstore OIDC, vs C2PA): Node has it built-in, works for CLI publishes from a laptop without platform lock-in, ergonomic for hobbyist authors. Sigstore OIDC is a planned follow-up — adds `pubkey_kind: 'sigstore-oidc'` dispatch to a Fulcio + Rekor verifier for repos that publish via a GitHub Actions workflow.
- [x] **packagehub** — Optional freemium / paid packages (marketplace foundation). New columns on `packages`: `license_tier` (`free`/`paid`/`subscription`, default `free`), `price_cents`, `payment_provider` (`stripe`/`lemonsqueezy`), `payment_link`. New `entitlements` table — `packageId` FK + (`workspaceId` OR `userId`) + `kind` (`purchase`/`subscription`/`grant`) + `externalRef` (idempotency key for webhooks) + `expiresAt`. New routes in [services/packagehub/src/routes/entitlements.routes.ts](services/packagehub/src/routes/entitlements.routes.ts): `GET /api/v1/entitlements?packageName=&workspaceId=` (the install-time gate; `free` short-circuits without a table lookup), `POST /api/v1/entitlements` (idempotent on `externalRef` — wire-compatible with Stripe webhooks), `DELETE /api/v1/entitlements/:id` (refunds). Default `free` keeps the open-source path; authors opt in by setting a different tier at publish.
- [x] **packages** — Entitlement check in install path. [services/packages/src/services/package-manager.ts](services/packages/src/services/package-manager.ts) `install()` now calls packagehub's `/api/v1/entitlements` *before* loading the manifest; throws `EntitlementRequiredError` (HTTP 402 Payment Required + `paymentLink` in the body) when the consumer has no entitlement for a non-free package. Transient packagehub outages don't block install (let the manifest-loader produce the clearer downstream error).
- [x] **packages** — Rollback capability for package upgrades. New `POST /api/v1/packages/:installId/rollback` endpoint backed by per-installation in-memory version history stack: `install()` seeds the stack with the freshly-installed version; `upgrade()` pushes the new version; `rollback()` pops to the previous one. Stack-of-1 returns HTTP 404 (`NO_HISTORY`). Persisting history to a Drizzle table is a follow-up — today's history resets across service restarts.
- [ ] **packagehub** — Package ratings and reviews. Independent of signing/marketplace.
- [ ] **packagehub** — Package dependency tree visualization. Read-only endpoint that walks `manifest.dependencies` recursively + returns a tree.
- [ ] **packages** — Auto-update notifications. Diff `installations.version` vs `package_versions.version` per workspace; emit a NATS event when a newer version is available; office-ui surfaces a toast.
- [ ] **packagehub** — GitHub Sigstore OIDC attestation as an alternate signing path. Verifier registered behind `pubkey_kind: 'sigstore-oidc'`; signatures resolve against Fulcio's transparency log + Rekor inclusion proof.
- [ ] **packagehub** — Stripe / Lemonsqueezy webhook receivers that map `checkout.session.completed` to `POST /api/v1/entitlements` (idempotent via `externalRef`).
- [ ] **packages** — Persisted installation/version history (Drizzle table) so rollback survives service restarts.
- [ ] **packagehub** — Key rotation story. Floor design is one-pubkey-per-package immutable.
- [ ] **office-ui** — Marketplace UI: browse paid packages, click-to-purchase via `paymentLink`, manage entitlements. §6.5-adjacent.

See [docs/PACKAGES.md](docs/PACKAGES.md) for the publish-and-sign workflow with full bash recipes.

### 6.4 Collaboration
- [x] **state** — Typing indicators for chat. New `TypingManager` ([services/state/src/services/typing-manager.ts](services/state/src/services/typing-manager.ts)) — short-lived (default 6s, matches Slack) "user is typing" flags scoped to `(userId, roomId)`. Subsequent pings refresh the expiry instead of duplicating; `listInRoom()` prunes expired entries as a side effect of read so the in-memory map doesn't grow unbounded. Three new routes: `POST /api/v1/rooms/:roomId/typing` (ping), `GET /api/v1/rooms/:roomId/typing` (poll), `DELETE /api/v1/rooms/:roomId/typing/:userId` (manual stop on submit). Pings scope per-room — same user can be typing in two rooms simultaneously. 6 new tests cover refresh, multi-user concurrent, multi-room scoping, expiry pruning.
- [x] **channel-router** — Email channel adapter ([adapters/email.adapter.ts](../channel-router/src/adapters/email.adapter.ts)). Normalizes inbound payloads from common transactional-mail provider webhooks (SendGrid/Mailgun/Postmark/SES `parse` endpoints): `from` field's "Display Name <addr>" gets split into `senderId` (lowercased address) and `senderName` (display name; falls back to local-part when no name). Body precedence: prefer `text`, fall back to a tag-stripped HTML approximation. Attachments mapped to canonical shape with `contentType`. Preserves `subject` / `messageId` / `inReplyTo` in `metadata` for thread correlation. Outbound `sendMessage` returns a Message-ID-shaped string (`<ulid@urule.local>`); actual SMTP relay integration is a follow-up.
- [x] **channel-router** — Discord channel adapter ([adapters/discord.adapter.ts](../channel-router/src/adapters/discord.adapter.ts)). Normalizes a Discord MESSAGE_CREATE gateway/webhook payload: `channel_id` → `channelId`, `author.global_name ?? author.username` → `senderName`, `content` → `text`. Attachments mapped via `content_type`. Metadata preserves `discordMessageId`, `guildId`, `replyTo` (from `message_reference.message_id`), and an `isBot` flag from `author.bot`. Both adapters registered in [server.ts](../channel-router/src/server.ts); `ChannelType` union extended to include `'discord'` (`'email'` was already there). 12 new tests across the two adapters cover RFC 2822 parsing, attachment mapping, metadata preservation, bot detection, reply-to extraction.
- [ ] **state** — Real-time collaborative editing (CRDT or OT). Substantial architectural work — Yjs-style document graph + room-scoped sync + persistence story. Defer until there's a UI surface that needs it (current widgets are read-mostly).
- [ ] **channel-router** — Microsoft Teams channel adapter. Similar shape to Slack/Discord but Teams' Activity payload is its own thing (BotFramework). Defer until there's actual Teams demand.

12 new tests in [channel-router/tests/email-discord-adapters.test.ts](../channel-router/tests/email-discord-adapters.test.ts) and 6 in [services/state/tests/typing.test.ts](services/state/tests/typing.test.ts).

### 6.5 Office UI Features
- [x] **office-ui** — Data export for lists (CSV, JSON). [lib/exportData.ts](apps/office-ui/src/lib/exportData.ts) provides `toCsv()` (RFC 4180-quoted, union-of-keys columns), `toJson()`, `triggerDownload()` (SSR-safe), and `exportRows()` one-call serialize+download with timestamped filenames. [components/ui/ExportButton.tsx](apps/office-ui/src/components/ui/ExportButton.tsx) drops into any list view: outside-click and Escape close, disables when rows is empty, format dropdown (default CSV+JSON; restrict via `formats` prop). Test-IDs (`export-button`, `export-menu`, `export-format-csv|json`) for Playwright targeting.
- [x] **office-ui** — Cmd+K command palette. [components/layout/CommandPalette.tsx](apps/office-ui/src/components/layout/CommandPalette.tsx) mounted globally inside [office/layout.tsx](apps/office-ui/src/app/office/layout.tsx) so it works on every authenticated page. Subsequence-fuzzy filter, ↑↓/Enter/Esc keyboard navigation, click-outside dismiss, autofocus on open. Built-in commands: 7 navigation entries (dashboard/agents/chat/approvals/projects/workspaces/settings), 3 theme switchers (dark/light/system), 1 sign-out. State held in [store/useCommandPaletteStore.ts](apps/office-ui/src/store/useCommandPaletteStore.ts) so any component can `toggle()` programmatically. Cmd+K + Ctrl+K both bound — works on Mac and elsewhere.
- [x] **office-ui** — User preferences store. [store/useUserPrefsStore.ts](apps/office-ui/src/store/useUserPrefsStore.ts) (zustand+persist, namespace `urule-user-prefs`): UI density (`comfortable`/`compact`), landing page (which `/office/*` route to default to), per-route list filters (keyed by route slug, arbitrary serialisable shape), favorites (kind+id+optional label, dedup-on-add). `notificationSoundsEnabled` slot reserved for the deferred sounds work. `partialize` keeps actions out of localStorage.
- [x] **office-ui** — Form draft auto-save. New [hooks/useFormAutoSave.ts](apps/office-ui/src/hooks/useFormAutoSave.ts): pairs with react-hook-form's `watch()` (or any reactive value) and persists to localStorage on a debounce (default 800ms). On mount, restores the persisted draft via the `onRestore` callback (typically `reset(draft)`); returns `{ hasDraft, lastSavedAt, discardDraft, getDraft }` so callers can render a "Saved 3s ago / Discard" UI. Storage keyed under `urule-form-draft:<storageKey>` to avoid cross-form collision; default `isEmpty()` predicate skips persisting all-blank state so an empty mount doesn't clobber a real draft. SSR-safe (no-op on server). Heavy forms (agent creation wizard, package publish) opt in by adding `useFormAutoSave({ storageKey, value: watch(), onRestore: reset })` and calling `discardDraft()` on submit success — no other plumbing required.
- [ ] **office-ui** — Undo/redo for form editing. Stack of dirty-state snapshots scoped to the form's react-hook-form context. Defer alongside future heavy-form work — the auto-save hook above gives "I lost my work to a crash/reload" coverage; undo/redo is the separate "I want to walk backward through edits I've made" feature, which is more invasive and only worth it for forms with substantial in-flight cognitive load.
- [x] **office-ui** — Real-time notification sounds (configurable). New [hooks/useNotificationSounds.ts](apps/office-ui/src/hooks/useNotificationSounds.ts): subscribes to `useToastStore`, plays a short Web Audio sine-tone on each new toast, type-keyed (success: ascending two-note A5→C#6 chime; info: E5; warning: C5; error: F#4). Gated by `useUserPrefsStore.notificationSoundsEnabled` (off by default; toggle exposed via Cmd+K command palette). Tones are synthesized in code — no audio assets shipped. Lazy AudioContext creation respects browser autoplay policies (no-op until user interaction); silently no-ops when AudioContext is unavailable (headless tests, very old browsers). Conservative peak gain (0.06) avoids startling users. Wired globally in [office/layout.tsx](apps/office-ui/src/app/office/layout.tsx) so it works on every authenticated page.

Two new commands added to the Cmd+K palette: "Enable/Disable notification sounds" (`prefs-sounds-toggle`) and "Switch to compact/comfortable density" (`prefs-density-toggle`) — both flip values in `useUserPrefsStore` so they persist.

New Playwright spec [office-ui/e2e/command-palette.spec.ts](apps/office-ui/e2e/command-palette.spec.ts) covers: open via Cmd/Ctrl+K, Escape closes, filter narrows the list, Enter on a navigation command routes correctly, plus a CSV-roundtrip smoke for the export utility's quoting contract. 5 new specs across 2 journey files.

### 6.6 Operations
- [x] **infra** — Prometheus metrics collection. New `@urule/observability` workspace package exports a Fastify `metricsPlugin` (built on `prom-client` 15) that exposes `GET /metrics` returning the Prometheus exposition format. Default labels include `service`. `http_requests_total{method,route,status_code}` counter and `http_request_duration_seconds` histogram populated via an `onResponse` hook. Default Node.js process metrics (CPU, RSS, event-loop lag, GC) included via `collectDefaultMetrics`. Per-plugin-instance `Registry` keeps multiple Fastify apps in the same process from cross-contaminating. Wired into all 10 services with `/metrics` added to each service's `publicRoutes` (Prometheus can't auth). New `prometheus` Compose service in [docker-compose.infra.yaml](infra/compose/docker-compose.infra.yaml) with [prometheus.yml](infra/compose/prometheus.yml) scrape config — registry/packagehub/state/adapter/approvals targets. 8 new tests in `@urule/observability`; no service-level test changes (covered by integration smoke).
- [x] **infra** — Grafana dashboards for service monitoring. New `grafana` Compose service with anonymous-Viewer access for local dev (admin/urule for edits). Datasources (Prometheus + Jaeger) auto-provisioned via [grafana-datasources.yml](infra/compose/grafana-datasources.yml). Starter [Urule Services dashboard](infra/compose/grafana-dashboard-services.json) auto-provisioned with 6 panels: per-service RPS, p95 latency, error rate (5xx %), event-loop lag, RSS memory, CPU. Live-validated end-to-end: registry → /metrics → Prometheus → Grafana shows live data after a few requests.
- [x] **infra (§4.4 complement)** — `@urule/observability` also exports `initOtel(serviceName)` which initializes `@opentelemetry/sdk-node` with HTTP auto-instrumentations + OTLP gRPC trace exporter. Falls back to `OTEL_DISABLED=true` for tests. Now wired into all 10 services' `src/index.ts` entrypoints; otel-collector → jaeger pipeline live-validated end-to-end. See §4.4 above.
- [x] **infra** — Deployment guide ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). Covers the full phase6 stack (what's in it, ports, image sources), prerequisites, Pattern B host pre-build requirement, first-boot recipe + boot order, env-var configuration matrix (LOG_LEVEL / CORS_ORIGINS / KEYCLOAK_REALM_URL / AUTH_FAIL_CLOSED / OTEL_* / DATABASE_URL / NATS_URL / TEMPORAL_ADDRESS), reverse-proxy / TLS guidance with example Caddyfile, logging + log rotation, resource-limit starting points (derive from Prometheus + Grafana panels), upgrade flow, rollback caveats around forward-only migrations, scale-out sketch, troubleshooting matrix.
- [x] **infra** — Backup/recovery documentation ([docs/BACKUP-RECOVERY.md](docs/BACKUP-RECOVERY.md)). Tabulates what's stateful (postgres, nats, prometheus, grafana), what's not (all stateless services). Per-store: backup recipes (`pg_dumpall`, `nats stream backup`, prometheus tsdb snapshot, grafana volume tar + per-dashboard API export), recovery recipes (full restore, per-database, NATS stream restore), and security caveats (urule:urule password ends up in dumps; drizzle's `__drizzle_migrations` survives the round-trip). Recommends quarterly restore drills with a sample script.
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
