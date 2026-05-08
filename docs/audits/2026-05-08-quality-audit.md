# Urule — Code-Quality Audit Report

**Repository**: [urule-ai/urule](https://github.com/urule-ai/urule)
**Commit audited**: `2399796` (HEAD of `main` at time of audit)
**Audit date**: 2026-05-08
**Auditor**: external review (Claude / Anthropic)
**Scope**: monorepo only (the 7 standalone repos `widget-sdk`, `mcp-gateway`, `orchestrator-adapters`, `channel-router`, `approvals`, `runtime-broker`, `orchestrator-contract` are out of scope unless their contract surface appears in this repo)
**LOC**: ~38.9k TypeScript / TSX across 16 workspaces (5 services, 7 packages, 1 app, 1 plugin, examples)

---

## How to read this report

Each finding is structured to be **paste-ready as a GitHub issue**:

- **Title** — issue title to use
- **Severity** — High / Medium / Low (justified per finding)
- **Category** — for triage label
- **Evidence** — `path:line` references
- **Description** — what's wrong and why it matters
- **Recommendation** — concrete fix
- **Effort** — rough sizing (S = ≤1h, M = ≤1 day, L = >1 day)

Severity is calibrated for an open-source platform pre-1.0 (`version: 0.1.0`). What would be "Critical" in a paid SaaS is often "High" here, because the security posture is openly under construction (see `SECURITY.md`). Pieces explicitly marked `(stub)` in route docs are not flagged as bugs — they're open-by-design TODO and the docstring tells the truth.

---

## Executive summary

| Bucket            | Count |
| ----------------- | ----- |
| **High**          | 7     |
| **Medium**        | 13    |
| **Low**           | 12    |
| **Informational** | 4     |
| **Total**         | 36    |

The **dominant pattern** is that quality gates exist on paper but are non-enforcing in practice:
- CI silences typecheck / build / audit failures.
- `eslint:recommended` is the only ruleset, with `no-unused-vars` explicitly disabled and no TypeScript plugin.
- Workspace cross-deps are pinned with `"*"`.
- Containers run as root and pull `:latest` for auth-critical infra (Keycloak, OpenFGA, OPA).

The **second pattern** is missing infrastructure for production-grade LLM use:
- No retry / backoff / timeout in `@urule/llm-providers`.
- No prompt caching for Anthropic system prompts (despite long system prompts being central to the personality-pack design).
- No token-usage capture in the streaming event shape, even though the DB schema reserves a `token_count` column.

These are mostly **mechanical fixes** — the architecture itself is sound. Most of this audit is about closing the gap between the design described in `CLAUDE.md` / `ARCHITECTURE.md` and what the code actually enforces today.

### What's strong (so the report isn't just a wall of complaints)

- **Strict TypeScript** is wired correctly: `strict: true` + `noUncheckedIndexedAccess: true` + `noImplicitOverride: true` — and *no* workspace overrides them.
- **Zod is used consistently** on POST/PATCH bodies in registry routes (sampled: agents, providers, workspaces, conversations).
- **Frontend type discipline is excellent**: 0 `as` casts in `apps/office-ui/src`, 2 `@ts-expect-error`/`@ts-ignore` total, React Query owns server state (no Zustand-as-cache anti-pattern).
- **Zustand stores are split by domain** (11 focused stores), not one mega-store.
- **Forms use `react-hook-form` + `zodResolver`** — no untyped form state.
- **PR templates and issue templates exist** (`.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md`).
- **`forbidOnly: !!process.env.CI`** in Playwright config — prevents `.only` from leaking into CI.
- **Multi-stage Dockerfiles** drop dev deps in the runner stage and have `HEALTHCHECK` directives.
- **The `@urule/llm-providers` API shape is well-designed** for adding providers — `LlmProvider` has one method, the streaming contract is clean, and `baseUrl` makes Ollama / vLLM drop-in. The work needed is *under* this contract (retry/timeout), not changing it.

---

# High-severity findings

## H-1 — CI silences every quality signal it claims to enforce

**Severity**: High &nbsp;·&nbsp; **Category**: ci, quality-gates &nbsp;·&nbsp; **Effort**: S

### Evidence

[`.github/workflows/ci.yml:21`](.github/workflows/ci.yml#L21):
```yaml
- name: Type check
  run: npm run typecheck:all 2>/dev/null || echo "Typecheck skipped for some packages"
```

[`.github/workflows/ci.yml:33`](.github/workflows/ci.yml#L33):
```yaml
- name: Build packages
  run: npm run build:all 2>/dev/null || true
```

[`.github/workflows/ci.yml:45-48`](.github/workflows/ci.yml#L45-L48):
```yaml
- name: Audit dependencies
  run: npm audit --audit-level=high || true
  continue-on-error: true
```

There is **no `lint` job at all** — the `lint-and-typecheck` job runs only the typecheck step, and even that is silenced.

### Description

The CI `README` badge says "CI" but the workflow cannot fail except on a syntax error in the test runner itself. Combined with `continue-on-error: true` on `audit`, a PR can merge to `main` while introducing type errors, build failures, *and* known-vulnerable dependencies. This invalidates the entire "we have CI" claim and undermines the contributor experience: a PR that breaks the typechecker shows a green check.

### Recommendation

1. Drop the `2>/dev/null || …` and `|| true` swallowers. Let the steps fail.
2. Add a `lint` job: `npm run lint:all` once the ESLint config is hardened (see [M-1](#m-1)).
3. Remove `continue-on-error: true` on `audit`. Pick a threshold (e.g. `--audit-level=critical`) and *gate* on it.
4. Add a `format-check` job: `npx prettier --check .`.

---

## H-2 — 18 known npm vulnerabilities, including 2 critical, ungated by CI

**Severity**: High &nbsp;·&nbsp; **Category**: dependencies, supply-chain &nbsp;·&nbsp; **Effort**: M

### Evidence

`npm audit` at HEAD:

> 18 vulnerabilities (9 moderate, 7 high, 2 critical)

Sample: `postcss < 8.5.10` ([GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), XSS via unescaped `</style>` in CSS Stringify) is pulled in via `next@14.2.x`. Fix requires `next@14.2.35+`.

CI does not block on this — see [H-1](#h-1).

### Description

Two critical vulnerabilities sit in the dependency tree of the main UI app, and the CI workflow is configured to ignore them. The package boundary doesn't matter for a determined attacker — these end up in the production image.

### Recommendation

1. Run `npm audit fix` (non-breaking), audit the changed lockfile, commit.
2. For the breaking ones, plan minor-version upgrades: Next.js to 14.2.35+ (or 15.x once `app/` patterns are validated), `drizzle-orm` to `0.45.x`+, etc.
3. Adopt Dependabot or Renovate (`.github/dependabot.yml` — minimal: weekly, grouped by ecosystem) and pair with [H-1](#h-1) to actually gate.
4. Consider `npm-audit-resolver` for known-accepted false positives.

---

## H-3 — All container images run as root (no `USER` directive)

**Severity**: High &nbsp;·&nbsp; **Category**: container-security &nbsp;·&nbsp; **Effort**: S

### Evidence

`grep -l 'USER ' services/*/Dockerfile apps/*/Dockerfile plugins/*/Dockerfile` returns **zero matches**. All eight Dockerfiles inherit `node:20-slim` without setting a non-root user:

- [`services/registry/Dockerfile`](services/registry/Dockerfile)
- [`services/packagehub/Dockerfile`](services/packagehub/Dockerfile)
- [`services/packages/Dockerfile`](services/packages/Dockerfile)
- [`services/governance/Dockerfile`](services/governance/Dockerfile)
- [`services/state/Dockerfile`](services/state/Dockerfile)
- [`apps/office-ui/Dockerfile`](apps/office-ui/Dockerfile)
- [`plugins/backstage/Dockerfile`](plugins/backstage/Dockerfile)
- [`infra/e2e/Dockerfile`](infra/e2e/Dockerfile)

### Description

Running as root in the container is a defense-in-depth failure. If any service is compromised (e.g. via a future deserialization bug, a malicious MCP tool, a supply-chain incident), the attacker has root inside the container — easier privilege escalation, easier mounting of sensitive paths, easier writing to the read-only filesystem if you ever set `readOnlyRootFilesystem: true` in Helm.

### Recommendation

Append to every runner stage:
```dockerfile
RUN groupadd -r urule && useradd -r -g urule -u 10001 urule \
    && chown -R urule:urule /app
USER urule
```
Helm chart should also set `securityContext.runAsNonRoot: true` and `runAsUser: 10001`. This pairs naturally with [H-4](#h-4).

---

## H-4 — Auth-critical infra images use `:latest`

**Severity**: High &nbsp;·&nbsp; **Category**: container-security, reproducibility &nbsp;·&nbsp; **Effort**: S

### Evidence

[`infra/compose/docker-compose.infra.yaml`](infra/compose/docker-compose.infra.yaml):

| Service       | Image tag                                       |
| ------------- | ----------------------------------------------- |
| Keycloak      | `quay.io/keycloak/keycloak:latest` ⚠           |
| OpenFGA       | `openfga/openfga:latest` ⚠                     |
| OPA           | `openpolicyagent/opa:latest` ⚠                 |
| Temporal      | `temporalio/auto-setup:latest` ⚠               |
| Temporal UI   | `temporalio/ui:latest` ⚠                       |
| OTel collector| `otel/opentelemetry-collector-contrib:latest` ⚠|
| Jaeger        | `jaegertracing/all-in-one:latest` ⚠            |
| Postgres      | `postgres:16-alpine` ✓                          |
| NATS          | `nats:2-alpine` ✓                               |
| Grafana       | `grafana/grafana:11.3.0` ✓                      |
| Prometheus    | `prom/prometheus:v2.55.0` ✓                     |

[`infra/helm/urule/values.yaml:15`](infra/helm/urule/values.yaml#L15) also defaults `imageTag: latest` for the urule services themselves.

### Description

The five identity- and policy-critical images (Keycloak, OpenFGA, OPA, Temporal × 2) all float on `:latest`. A `docker compose up` six months from now can produce a materially different cluster than today's, including auth behaviour drift. This breaks the "Get Started in 60 Seconds" promise the README makes, and silently *changes* what gets pulled when `imagePullPolicy: IfNotPresent` falls through.

### Recommendation

Pin every image to a semver tag (or, ideally, a digest):
```yaml
image: quay.io/keycloak/keycloak:26.0.7
image: openfga/openfga:v1.8.4
image: openpolicyagent/opa:0.71.0
# ...
```
For Helm, change `imageTag: latest` to a real version and document the upgrade contract.

---

## H-5 — Widget iframe bridge has no origin enforcement (postMessage `*` + no `event.origin` check)

**Severity**: High &nbsp;·&nbsp; **Category**: frontend-security, widget-sandboxing &nbsp;·&nbsp; **Effort**: S

### Evidence

[`apps/office-ui/src/widgets/WidgetFrame.tsx:20-28`](apps/office-ui/src/widgets/WidgetFrame.tsx#L20-L28):
```tsx
iframeRef.current?.contentWindow?.postMessage(
  { type, widgetId: context.widgetId, payload, timestamp: Date.now() },
  "*"   // ← targetOrigin is wildcard
);
```

[`apps/office-ui/src/widgets/WidgetFrame.tsx:33-56`](apps/office-ui/src/widgets/WidgetFrame.tsx#L33-L56):
```tsx
function handleMessage(event: MessageEvent) {
  const data = event.data;
  if (!data || data.widgetId !== context.widgetId) return;
  // ← no event.origin check
```

Iframe sandbox at line 67: `sandbox="allow-scripts allow-same-origin allow-forms"` — `allow-same-origin` together with `allow-scripts` from the same origin **disables sandboxing** entirely (per the HTML spec).

### Description

Three issues compound:
1. **Outbound**: `postMessage(msg, "*")` will deliver `init` messages — including `theme`, `config`, `permissions`, and `workspaceId` — to whatever origin the iframe currently navigates to. A widget that follows a redirect to an attacker domain leaks the host context.
2. **Inbound**: messages are gated only by `widgetId` equality, not origin. Any tab the user has open can `postMessage` into the parent window with the right `widgetId` and trigger `widget:ready` → init reflection. The widget ID is not a secret (it appears in the manifest).
3. **Sandbox**: `allow-same-origin` + `allow-scripts` from the same parent origin is the documented un-sandbox path; the widget runs with full access to the parent's storage.

The widget system is sold in the README as a security boundary — it isn't, today.

### Recommendation

1. Compute and store the expected widget origin from `entryUrl` (`new URL(entryUrl).origin`).
2. Pass that origin as `targetOrigin` to `postMessage` (never `"*"`).
3. Gate `handleMessage` with `if (event.origin !== expectedOrigin) return`.
4. Drop `allow-same-origin` from the sandbox, or only grant it for built-in (first-party) widget URLs. For third-party widgets, the iframe should be cross-origin.
5. Document the bridge security model in `widget-sdk` and link to it from `WidgetFrame.tsx`.

This is also covered (in spirit) by the `widget-sdk` repo's protocol; the missing piece is *enforcement* in the host.

---

## H-6 — `GET /api/v1/agents` returns every agent in every workspace, with no admin guard

**Severity**: High &nbsp;·&nbsp; **Category**: authz, multi-tenancy &nbsp;·&nbsp; **Effort**: M

### Evidence

[`services/registry/src/routes/agents.routes.ts:84-104`](services/registry/src/routes/agents.routes.ts#L84-L104):
```ts
app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/v1/agents', {
  schema: {
    summary: 'List all agents',
    description: '... Admin-shaped — most callers should use `/workspaces/:wsId/agents` instead.',
  },
}, async (request) => {
  const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 100);
  const offset = parseInt(request.query.offset ?? '0', 10);
  const rows = await db.select().from(agents).limit(limit).offset(offset);   // ← no WHERE
  // ...
});
```

The docstring **claims** the endpoint is "admin-shaped", but the handler has no role check, no governance call, and no workspace filter against the caller's identity.

The same pattern likely applies to other `/api/v1/<entity>` list routes (workspaces, providers) — worth a sweep.

### Description

In a multi-tenant deployment, any authenticated user can list every other tenant's agents (and, via the joined provider record, the model name and base URL — but not the API key, which is good). This violates the multi-tenancy claim in `ARCHITECTURE.md`. The CLAUDE.md auth-flow recipe says "service validates via `@urule/auth-middleware` → governance/authz checks" — the second half is not implemented for list routes.

### Reproduction

1. Spin up two tenants A and B. Create agent in tenant B.
2. Authenticate as tenant A user (any valid Keycloak JWT).
3. `GET /api/v1/agents` — tenant B's agent appears.

### Recommendation

1. Add an admin-role guard to `/api/v1/agents` (the doc says it's admin-shaped; enforce it):
   ```ts
   if (!request.uruleUser?.roles?.includes('admin')) {
     return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'admin required' } });
   }
   ```
2. Or remove the cross-tenant list endpoint and force callers to `/api/v1/workspaces/:wsId/agents`.
3. Audit every other `/api/v1/<entity>` list route in `services/registry` for the same pattern.
4. Add a regression integration test: tenant-A user → 403 on tenant-B's data.

---

## H-7 — `@urule/llm-providers` has no retry, no timeout, no abort, no usage tracking

**Severity**: High &nbsp;·&nbsp; **Category**: ai-integration, reliability &nbsp;·&nbsp; **Effort**: M

### Evidence

[`packages/llm-providers/src/anthropic-provider.ts:32-44`](packages/llm-providers/src/anthropic-provider.ts#L32-L44) — single try/catch around `client.messages.stream`; on failure, yields one `{type:'error'}` event and returns. No retry, no backoff.

[`packages/llm-providers/src/openai-provider.ts:42-99`](packages/llm-providers/src/openai-provider.ts#L42-L99) — same pattern. No retry on rate limits or transient 5xx.

[`packages/llm-providers/src/types.ts:61-78`](packages/llm-providers/src/types.ts#L61-L78) — `LlmStreamParams` has no `timeout`, no `signal`, no `abortSignal`. Streams cannot be cancelled.

[`packages/llm-providers/src/types.ts:86-95`](packages/llm-providers/src/types.ts#L86-L95) — `LlmEvent.message_complete` has `finishReason`, `fullText`, `toolCalls` — but no `inputTokens` / `outputTokens` / `cacheReadTokens`. The DB schema has [`messages.token_count`](services/registry/src/db/schema/conversations.ts#L41) but the LLM layer never populates it.

### Description

`@urule/llm-providers` is the single chokepoint for every LLM call in the system, and every operational property a production LLM caller needs is missing:

- **No retry** — a 429 from Anthropic or OpenAI hard-fails the user's chat turn. This is by far the most common transient failure with LLM APIs.
- **No timeout** — a hung connection blocks the orchestrator-adapter thread indefinitely; the SDK defaults are not surfaced.
- **No cancellation** — when the user closes the chat tab, the upstream call cannot be aborted.
- **No usage** — operators cannot see per-agent / per-model token spend, which makes the platform's "control plane" claim weak.

### Recommendation

1. Add `signal?: AbortSignal` to `LlmStreamParams`, plumb it through to both SDKs (`client.messages.stream(...).abort()` for Anthropic; OpenAI's SDK accepts an `{ signal }` request option).
2. Add `timeoutMs?: number` to `LlmStreamParams`, default 60s, implement as `AbortSignal.timeout(...)` combined with the user's signal.
3. Add a `withRetry` wrapper around the stream creation: 3 attempts, exponential backoff with full jitter (250ms / 1s / 4s), retry only on 429 + 5xx + AbortError-from-timeout (not from caller).
4. Extend `LlmEvent.message_complete` with `usage: { inputTokens, outputTokens, cacheReadTokens?, cacheCreationTokens? }` populated from `finalMessage.usage` (Anthropic) and `chunk.usage` (OpenAI, requires `stream_options: { include_usage: true }`).
5. Have orchestrator-adapter persist `usage.outputTokens` to `messages.token_count`.

---

# Medium-severity findings

## M-1 — ESLint config is essentially decorative

**Severity**: Medium &nbsp;·&nbsp; **Category**: lint, dx &nbsp;·&nbsp; **Effort**: S

[`.eslintrc.json`](.eslintrc.json) has only `extends: ["eslint:recommended"]`, with `no-unused-vars: "off"` and `no-console: "warn"`. It declares `parser: "@typescript-eslint/parser"` but extends *no* TypeScript rules — so `eslint:recommended` (a JS ruleset) runs against `.ts` files and misses TypeScript-specific bugs. There is no `eslint-plugin-import` (no `no-cycle`, no `order`), no React plugin (Next.js app's hook deps go unchecked), no per-workspace override (`root: true` blocks them).

The CI doesn't run `lint` at all (see [H-1](#h-1)), so the config's anaemia hasn't been visible.

**Recommendation**: adopt `@typescript-eslint/recommended-type-checked`, `eslint-plugin-import` with `import/no-cycle`, and `eslint-config-next` for the app. Re-enable `no-unused-vars` via `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: "^_"`. Land alongside the CI fix in [H-1](#h-1) so it can't drift.

---

## M-2 — Workspace cross-deps pinned with `"*"` (versionless)

**Severity**: Medium &nbsp;·&nbsp; **Category**: dependencies, build-determinism &nbsp;·&nbsp; **Effort**: S

`grep -rE '"@urule/[^"]+":\s*"\*"' --include='package.json'` returns ~18 instances across services and the backstage plugin. Example: [`services/registry/package.json:25-28`](services/registry/package.json#L25-L28).

`"*"` resolves to whatever the workspace currently has and gets `npm install`-time-baked into the lockfile, but it bypasses semver intent: when a package's behaviour changes, dependents have no way to declare their requirement.

**Recommendation**: switch to `"workspace:*"` (npm 8.3+ supports this in workspaces) or pin to the actual version. Adopt one and document it.

---

## M-3 — `drizzle-orm` is in the **root** `devDependencies`

**Severity**: Medium &nbsp;·&nbsp; **Category**: dependencies &nbsp;·&nbsp; **Effort**: S

[`package.json:60`](package.json#L60) declares `"drizzle-orm": "^0.45.2"` as a *dev*Dependency at the monorepo root. Drizzle is a runtime dependency and is correctly re-declared in each service's `dependencies`. Having it at root devDep level is misleading and risks accidental version drift between the root and per-service pins.

**Recommendation**: remove it from root unless it's specifically needed for `drizzle-kit` config files in the root (in which case it's fine — but verify and document why).

---

## M-4 — `(request as any).uruleUser` cast — auth middleware lacks a Fastify type augmentation

**Severity**: Medium &nbsp;·&nbsp; **Category**: type-safety &nbsp;·&nbsp; **Effort**: S

`grep -rn '(request as any)' services/ packages/ apps/office-ui/src` returns 6 hits, all reading `(request as any).uruleUser`. Examples: [`services/registry/src/routes/agents.routes.ts:158`](services/registry/src/routes/agents.routes.ts#L158), [`services/registry/src/routes/agents.routes.ts:398`](services/registry/src/routes/agents.routes.ts#L398).

This is the only `as any` cluster in service code — the rest is clean. The cause is that `@urule/auth-middleware` doesn't publish a Fastify module augmentation declaring `request.uruleUser`.

**Recommendation**: in `packages/auth-middleware/src/plugin.ts`, add:
```ts
declare module 'fastify' {
  interface FastifyRequest {
    uruleUser?: UruleUser;
  }
}
```
Then drop the casts. With CLAUDE.md's strict ban on `any`, this is also a credibility point.

---

## M-5 — Error-response envelope is inconsistent across routes

**Severity**: Medium &nbsp;·&nbsp; **Category**: api-contract &nbsp;·&nbsp; **Effort**: M

`CLAUDE.md` itself documents two formats:
- `{ error: 'Validation failed', details: [...] }` (string + details)
- `{ error: { code: 'X_NOT_FOUND', message: '...' } }` (structured)

In `services/registry/src/routes/`:
- 404s use the structured form (good).
- 400s use the string form.
- `auth.routes.ts:61` adds a third variant: `{ error: 'string', detail: 'string' }` (singular `detail`).

API clients (the office-ui axios layer + any third-party SDK) have to handle all three. For an OpenAPI-annotated API like this one, the contract should be a single `Error` schema referenced from every error response.

**Recommendation**:
1. Define `Error` once in `packages/spec` as `{ error: { code: string; message: string; details?: unknown } }`.
2. Replace the string form everywhere; preserve `details` for Zod issues.
3. Centralise into `middleware/error-handler.ts` so route handlers just `throw new ApiError(code, message, details)`.

---

## M-6 — N+1 query on `GET /api/v1/agents` (provider lookup per row)

**Severity**: Medium &nbsp;·&nbsp; **Category**: db-performance &nbsp;·&nbsp; **Effort**: S

[`services/registry/src/routes/agents.routes.ts:93-103`](services/registry/src/routes/agents.routes.ts#L93-L103):
```ts
const rows = await db.select().from(agents).limit(limit).offset(offset);
return Promise.all(rows.map(async (row) => {
  const config = (row.config ?? {}) as Record<string, unknown>;
  const providerId = config.provider_id as string | undefined;
  let provider = null;
  if (providerId) {
    const [p] = await db.select().from(providers).where(eq(providers.id, providerId));
    provider = p ?? null;
  }
  return toUiAgent(row as Record<string, unknown>, provider);
}));
```

`Promise.all` runs the per-row queries in parallel, which softens the latency hit, but it's still N round trips and N rows worth of pool pressure for a request that should be one query.

**Recommendation**:
1. Collect the distinct `provider_id` values from `rows`.
2. `db.select().from(providers).where(inArray(providers.id, ids))`.
3. Build a `Map<id, provider>` and decorate.

Alternative: a left join in Drizzle, but the join key being JSONB makes that awkward — fix the schema by lifting `provider_id` to a real column on `agents` (it's queried on every list).

---

## M-7 — Webhook idempotency guard has no backing unique constraint

**Severity**: Medium &nbsp;·&nbsp; **Category**: race-condition, billing-correctness &nbsp;·&nbsp; **Effort**: S

[`services/packagehub/src/routes/webhooks.routes.ts:142-148`](services/packagehub/src/routes/webhooks.routes.ts#L142-L148) checks `SELECT ... WHERE (packageId, externalRef)` and inserts if not found. Two concurrent webhook deliveries from Stripe (which retries aggressively) can both pass the check and create duplicate entitlements.

**Recommendation**: add a unique constraint on `(package_id, external_ref)` in the Drizzle schema and switch the insert to `INSERT ... ON CONFLICT (package_id, external_ref) DO NOTHING RETURNING *`. The unique index is the correctness boundary; the application code should *rely* on it, not duplicate it.

---

## M-8 — Multi-step mutations not wrapped in `db.transaction()`

**Severity**: Medium &nbsp;·&nbsp; **Category**: data-integrity &nbsp;·&nbsp; **Effort**: M

[`services/registry/src/routes/conversations.routes.ts:407-431`](services/registry/src/routes/conversations.routes.ts#L407-L431) — conversation branching inserts a new conversation row, then copies messages, then attaches agents — across three separate `await db.insert(...)` calls. If the second or third fails, the new branch exists in a half-formed state.

Sweep needed across other `services/registry` routes that mutate >1 table per request.

**Recommendation**: wrap multi-statement mutations in `db.transaction(async (tx) => { ... })`. Drizzle's API is straightforward; the cost is mostly mechanical.

---

## M-9 — Anthropic prompt caching is not used

**Severity**: Medium &nbsp;·&nbsp; **Category**: ai-integration, cost &nbsp;·&nbsp; **Effort**: S

[`packages/llm-providers/src/anthropic-provider.ts:33-40`](packages/llm-providers/src/anthropic-provider.ts#L33-L40) passes `system: params.systemPrompt` as a plain string. There's no `cache_control: { type: 'ephemeral' }` block, no breakpoint structure.

The personality-pack design described in the README assumes long, stable system prompts (the setup wizard ships ~28 templates each ≥300 tokens). Multi-turn chats re-pay the system-prompt token cost every turn instead of getting a 5-minute cache hit.

**Recommendation**:
- Convert system to the structured form: `system: [{ type: 'text', text: params.systemPrompt, cache_control: { type: 'ephemeral' } }]` when the prompt is ≥1024 tokens.
- Surface `cacheReadInputTokens` / `cacheCreationInputTokens` in the usage shape from [H-7](#h-7).

This is one of the highest leverage changes in the codebase — typical 60-90% input-token cost reduction on multi-turn chat with stable system prompts.

---

## M-10 — Tool-call argument JSON parse failure is silently swallowed (OpenAI)

**Severity**: Medium &nbsp;·&nbsp; **Category**: ai-integration, observability &nbsp;·&nbsp; **Effort**: S

[`packages/llm-providers/src/openai-provider.ts:104-110`](packages/llm-providers/src/openai-provider.ts#L104-L110):
```ts
} catch {
  // Provider can stream malformed JSON if the model truncates;
  // surface as an empty input — adapter can flag the bad call.
  parsedInput = { __raw: partial.argumentsBuffer };
}
```

The adapter has no way to know the parse failed: `LlmToolCall.input` is just `Record<string, unknown>` and the comment's "adapter can flag" relies on every adapter inspecting for the `__raw` magic key.

**Recommendation**: add an explicit `LlmEvent` variant `{ type: 'tool_call_invalid', toolCallId, raw, parseError }` *or* extend `LlmToolCall` with `parseError?: string`. The default code path should not lose the signal that the model produced malformed output.

---

## M-11 — Frontend mutations missing `onError` toasts (silent network failures)

**Severity**: Medium &nbsp;·&nbsp; **Category**: ux, frontend &nbsp;·&nbsp; **Effort**: S

[`apps/office-ui/src/app/office/chat/[conversationId]/page.tsx:415-423`](apps/office-ui/src/app/office/chat/[conversationId]/page.tsx#L415-L423) — `sendMutation` and `actionMutation` have no `onError` handler. A network failure or 500 produces no user feedback. Pattern likely repeats across the app.

**Recommendation**: introduce a default mutation handler in the React Query client (`mutations: { onError: (err) => toast.error(...) }`) and only override when a route wants custom handling. Sweep mutations and remove silent failures.

---

## M-12 — Zero unit tests in `apps/office-ui/src` (only Playwright E2E)

**Severity**: Medium &nbsp;·&nbsp; **Category**: testing &nbsp;·&nbsp; **Effort**: L

`find apps/office-ui/src -name '*.test.*'` returns 0. The 18 Playwright specs (`apps/office-ui/e2e/*.spec.ts`) are good, but they cover happy paths against a running stack — they miss component-level behaviour (form validation edge cases, hook bug regressions, store reducer behaviour).

**Recommendation**: add Vitest + React Testing Library for the office-ui app. Start with the highest-leverage pieces: the axios interceptor's 401-refresh flow, the `useFormAutoSave` hook (already has well-defined behaviour), and the form Zod schemas.

---

## M-13 — `apps/office-ui` `WidgetFrame` finding compounds with no manifest signature verification

**Severity**: Medium &nbsp;·&nbsp; **Category**: widget-security &nbsp;·&nbsp; **Effort**: M

Companion to [H-5](#h-5). The widget-sdk repo specifies an iframe protocol; this repo's host trusts whatever manifest gets registered. If the marketplace ever serves third-party widget manifests, a malicious manifest can register an `entryUrl` pointing at attacker infrastructure, and there's no signature check before instantiation.

**Recommendation**: out of scope for this audit (it's in widget-sdk's contract surface), but worth filing here so the office-ui team knows it's a host-side enforcement responsibility, not a library responsibility.

---

# Low-severity findings

## L-1 — `console.log` in service code despite explicit ban in CLAUDE.md

[`services/registry/src/routes/agents.routes.ts:14-16`](services/registry/src/routes/agents.routes.ts#L14-L16) — `AuditLogger` factory uses `console.log(JSON.stringify(...))`. Same pattern in [`services/registry/src/routes/auth.routes.ts:7`](services/registry/src/routes/auth.routes.ts#L7), [`services/registry/src/routes/providers.routes.ts:11`](services/registry/src/routes/providers.routes.ts#L11), [`services/governance/src/routes/governance.routes.ts:14`](services/governance/src/routes/governance.routes.ts#L14), [`services/state/src/index.ts:15`](services/state/src/index.ts#L15).

CLAUDE.md anti-patterns list says "Use `console.log` — use `request.log` or `app.log` (Pino)". The audit logger's purpose is structured logging — Pino is literally what it should be using.

**Fix**: thread `app.log` into `AuditLogger`'s constructor, or have it accept a Pino-compatible logger.

---

## L-2 — Audit-logger errors swallowed by `.catch(() => {})`

The pattern `audit.entityCreated(...).catch(() => {})` appears in 7+ places (e.g. [`agents.routes.ts:163`](services/registry/src/routes/agents.routes.ts#L163)). Audit failures are silently dropped — bad for an audit pipeline. At least `app.log.warn`.

---

## L-3 — No test coverage thresholds in any `vitest.config.ts`

All ~12 vitest configs are bare `{ test: { include: [...] } }` — no coverage block, no gate.

**Fix**: pick a starting threshold (e.g. 60% lines) per service, ratchet upward.

---

## L-4 — CI uses `npm install`, not `npm ci`

`.github/workflows/ci.yml` lines 19, 31, 44 use `npm install` — which can mutate `package-lock.json`. CI builds should be lockfile-deterministic.

**Fix**: change to `npm ci`.

---

## L-5 — GitHub Actions pinned to floating major (`@v4`), not commit SHAs

All `actions/*`, `docker/*` references use `@v4`/`@v5`/`@v6` floating tags. A maintainer-account compromise on the action repo can publish a malicious `v4` tag and silently land in this CI.

**Fix**: pin to SHAs and let Dependabot bump them with PR review (`actions/checkout@b4ffde65f… # v4.1.7`).

---

## L-6 — No `CODEOWNERS` file

Auto-review assignment isn't configured. For an OSS project that's already attracted contributors, this slows triage.

---

## L-7 — `imageTag: latest` in Helm chart values default

[`infra/helm/urule/values.yaml:15`](infra/helm/urule/values.yaml#L15). Companion to [H-4](#h-4) — even after the infra images are pinned, the Helm chart still defaults to `latest` for the urule services.

---

## L-8 — Plaintext `POSTGRES_PASSWORD: urule` in compose env

[`infra/compose/docker-compose.infra.yaml`](infra/compose/docker-compose.infra.yaml#L14). Acknowledged dev-only, but normalising plaintext-secrets-in-compose is a habit that bites later. Consider sourcing from `${POSTGRES_PASSWORD:-urule}` so dev still works but CI / staging can override.

---

## L-9 — Hardcoded model identifiers scattered across UI and backend

Examples:
- `apps/office-ui/src/app/setup/page.tsx` — `defaultModel: 'gpt-4o-mini'`
- `apps/office-ui/src/app/office/settings/page.tsx` — `'anthropic/claude-3.5-sonnet'`, `'openai/gpt-4o'`
- `services/registry/src/db/schema/providers.ts` — `model_name` is a free-form string

A retired model identifier (e.g., `claude-3-opus-20240229`) won't fail until runtime. There's no central registry of "currently allowed" models.

**Fix**: move to a `packages/spec/src/models.ts` registry with a Zod enum. The provider record validates its `model_name` against the registry on insert/update. Add a `deprecated_at` field for graceful sunset.

---

## L-10 — Stripe webhook event body not Zod-parsed (signature is, but shape isn't)

[`services/packagehub/src/routes/webhooks.routes.ts:98`](services/packagehub/src/routes/webhooks.routes.ts#L98) — `const event = request.body as StripeEvent;`. The signature is verified upstream, so this isn't a security finding, but defense-in-depth would Zod-parse the event before reading nested fields.

---

## L-11 — Provider `apiKey` not format-validated on insert

[`services/registry/src/routes/providers.routes.ts:106,120`](services/registry/src/routes/providers.routes.ts#L106) — accepts any non-empty string. A malformed key is stored and fails at first LLM call. A `provider`-aware Zod refinement (`sk-ant-*`, `sk-*` prefixes) would surface the typo at create-time.

---

## L-12 — Flaky `waitForTimeout(2000)` in Playwright spec

[`apps/office-ui/e2e/dashboard.spec.ts:10-14`](apps/office-ui/e2e/dashboard.spec.ts#L10-L14). Replace with `waitForSelector` or `expect(locator).toBeVisible()`.

---

# Informational findings

## I-1 — MCP integration routes are explicitly stubbed (open-by-design)

[`services/registry/src/routes/integrations.routes.ts`](services/registry/src/routes/integrations.routes.ts) — every route's OpenAPI summary is `(stub)` and the docstrings explain what the real implementation will do. This is *correctly* documented WIP, not a hidden bug.

The reason this is in the report at all: a security scanner that doesn't read OpenAPI summaries will flag `POST /api/v1/integrations/mcp` as accepting input without persisting it. Surface this in the README or in an `INTEGRATIONS.md` so the WIP status is visible without grepping the routes.

---

## I-2 — Orchestrator-adapter contract defined in a separate repo

CLAUDE.md mentions "8 methods" of the adapter contract, but no `OrchestratorAdapter` interface lives in this repo (it's in `urule-ai/orchestrator-contract`). That's fine architecturally — but cross-repo drift is a real risk. Consider depending on `@urule/orchestrator-contract` from `packages/spec` so the contract version is in this repo's lockfile.

---

## I-3 — Risk-level classification for HITL is static config in the UI

[`apps/office-ui/src/app/office/approvals/page.tsx:46-54`](apps/office-ui/src/app/office/approvals/page.tsx#L46-L54) defines `RISK_CONFIG` as a static map. The actual `risk_level` value comes from the approval entity (presumably populated in the standalone `approvals` repo). Worth documenting where the dynamic classification logic lives, or it'll keep getting re-asked.

---

## I-4 — Zustand stores have no selector pattern

11 well-scoped stores, but components consume the whole store object. No correctness bug; with `useShallow` or selector functions, React renders less. Premature optimisation today, worth tracking when a store grows.

---

# Overlap with the prior security audit (2026-05-08)

The repo already had a same-day external **security** audit ([tracking issue urule-ai/urule#20](https://github.com/urule-ai/urule/issues/20)). Three of this quality audit's findings duplicate already-filed security issues; another three are related but distinct. To avoid issue-tracker spam, **direct duplicates are not refiled** — they are cross-referenced from the quality tracking issue.

| Quality finding              | Status                  | Security counterpart                                             |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------- |
| [H-1](#h-1) CI silenced      | **Duplicate — not refiled** | [urule-ai/urule#19](https://github.com/urule-ai/urule/issues/19) (M-04) |
| [H-5](#h-5) Widget postMessage | **Duplicate — not refiled** | [urule-ai/urule#15](https://github.com/urule-ai/urule/issues/15) (H-06) |
| [L-1](#l-1) Audit-logger uses `console.log` | **Duplicate — not refiled** | [urule-ai/urule#18](https://github.com/urule-ai/urule/issues/18) (H-12) |
| [H-3](#h-3) Containers run as root | Filed (quality lens)    | Security audit's M-03 (covered in #20, not filed individually)   |
| [H-4](#h-4) `:latest` tags   | Filed (quality lens)    | Security audit's L-03 (covered in #20, not filed individually)   |
| [H-6](#h-6) Cross-tenant `/api/v1/agents` | Filed (quality lens)    | Specific instance of security #4 (C-04 systemic missing authz)   |

The quality lens differs from the security lens on the latter three: a security report frames root containers / `:latest` / missing authz as defense-in-depth gaps; a quality report frames them as **deployment-determinism** and **multi-tenancy contract** failures. The fixes are largely the same; the framing matters for triage and ownership.

# Suggested issue triage

If the maintainers want to file from this report, this is the order I'd recommend:

1. **Land [H-1](#h-1) first.** Without real CI gating, every other fix can regress silently. This unlocks everything else.
2. Then [H-2](#h-2), [M-1](#m-1) — making the new gates non-trivial.
3. **Security batch**: [H-3](#h-3), [H-4](#h-4), [H-5](#h-5) can ship as a single "container & widget hardening" PR series.
4. **Multi-tenancy batch**: [H-6](#h-6) plus the authz sweep on other list endpoints.
5. **LLM batch**: [H-7](#h-7), [M-9](#m-9), [M-10](#m-10) make `@urule/llm-providers` production-ready.
6. **Type/contract cleanup**: [M-4](#m-4), [M-5](#m-5), [M-2](#m-2), [M-3](#m-3) — small wins, mostly mechanical.
7. The Lows can be picked up as good-first-issue tickets for new contributors.

---

# Methodology notes

- Tools: `git`, `grep`, file reads, `npm audit`, manual code review of routes/middleware/streaming code, parallel exploratory survey of the four major axes (services, frontend, AI integration, build infra).
- Out of scope: dynamic testing (no live deployment was hit), penetration testing, dependency-graph deep audit beyond `npm audit`, the 7 standalone repos.
- Findings I deliberately did *not* flag:
  - Things `CLAUDE.md` documents as "we know, planned for later" (most stubs).
  - Style preferences without impact.
  - Generic best-practice advice that wasn't anchored to a specific line of this codebase.
- Numbers cited (LOC, vuln counts, file counts) were measured at audit time on commit `2399796`.

---

*End of report.*
