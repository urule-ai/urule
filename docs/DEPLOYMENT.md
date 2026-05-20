# Deployment

This guide covers production-shaped Urule deployments. The reference stack is `docker compose -f infra/compose/docker-compose.phase6.yaml up -d`. Kubernetes is tracked separately (Helm charts — see ROADMAP §6.6).

## What's in the stack

[infra/compose/docker-compose.phase6.yaml](../infra/compose/docker-compose.phase6.yaml) brings up the full system. It pulls in [docker-compose.infra.yaml](../infra/compose/docker-compose.infra.yaml) via `include:` for shared infra.

| Component | Image / source | Default port | Role |
|---|---|---|---|
| postgres | `postgres:16-alpine` | 5500 | Per-service databases (registry, packagehub, mcp_gateway, runtime_broker, approvals, urule_state, channel_router, keycloak, openfga, temporal, temporal_visibility) |
| nats | `nats:2-alpine` (JetStream on) | 4222 / 8222 | Event bus + KV |
| keycloak | `quay.io/keycloak/keycloak:latest` | 8281 | Identity / JWT issuer |
| openfga | `openfga/openfga:latest` | 8282 / 8283 | Authz |
| opa | `openpolicyagent/opa:latest` | 8284 | Policy |
| temporal | `temporalio/auto-setup:latest` | 7233 | Approval workflow engine |
| otel-collector | `otel/opentelemetry-collector-contrib:latest` | 4317 / 4318 | Trace ingest |
| jaeger | `jaegertracing/all-in-one:latest` | 16686 | Trace UI |
| prometheus | `prom/prometheus:v2.55.0` | 9090 | Metric scrape + storage |
| grafana | `grafana/grafana:11.3.0` | 3030 | Dashboards |
| registry | local build | 3001 | Source of truth |
| packagehub | local build | 3009 | Package discovery |
| state | local build | 3007 | Room presence / tasks |
| approvals | local build | 3003 | Approval workflows |
| adapter (langgraph-adapter) | local build | 3002 | AI orchestrator |
| channel-router | local build | 3006 | Multi-channel msg normalisation |
| runtime-broker | local build | 4500 | Sandbox session allocation |
| mcp-gateway | local build | 3005 | MCP server registry |
| office-ui | local build | 3000 | Next.js frontend |

Per-service `*-migrate` and `*-seed` one-shot containers run before the main service starts:
- `registry-migrate` / `registry-seed`, `packagehub-migrate` / `packagehub-seed`, `mcp-gateway-migrate` apply schema migrations and seed demo data idempotently. See [MIGRATIONS.md](MIGRATIONS.md).

## Prerequisites

- Docker Engine 24+ (for `compose include:` and `service_completed_successfully`)
- Docker Compose v2.5+
- Node.js 20+ (only needed at build time for the host-side workspace pre-build)
- ~6 GB RAM available to Docker on the host (postgres + temporal + keycloak are the heavy hitters)
- ~10 GB disk for image cache + Postgres data

## Build prerequisites (Pattern B pre-build)

Standalone services (langgraph-adapter, approvals, channel-router, runtime-broker, mcp-gateway) consume `@urule/*` packages via `file:` refs. Their Docker builds COPY pre-built `dist/` from the urule monorepo, so those `dist/` directories must exist on the host *before* `docker compose build`. From the `urule-repos/` parent directory:

```bash
npm --prefix urule install
npm --prefix urule run build:all
npm --prefix orchestrator-contract install
npm --prefix orchestrator-contract run build
```

Pattern A monorepo services (registry, packagehub, state, office-ui) re-build their workspace deps inside the Docker builder stage and don't strictly need this step, but running it keeps the host `dist/` in sync with the IDE / test workflow. See [§4.1.1 in ROADMAP](../ROADMAP.md) and the per-Dockerfile comments for the underlying constraint.

## First boot

```bash
cd urule-repos/urule
npm --prefix . run build:all                                     # Pattern B pre-req
npm --prefix ../orchestrator-contract run build                  # Pattern B pre-req
docker compose -f infra/compose/docker-compose.phase6.yaml build
docker compose -f infra/compose/docker-compose.phase6.yaml up -d
```

Boot order (dependency-managed by `depends_on` + `service_completed_successfully`):
1. postgres, nats, opa, openfga, keycloak, temporal — infra reaches healthy.
2. `*-migrate` services run drizzle-kit + exit 0.
3. `*-seed` services psql-load idempotent SQL + exit 0.
4. `registry`, `packagehub`, `state`, `mcp-gateway`, `channel-router`, `runtime-broker`, `approvals`, `adapter` come up healthy.
5. `office-ui` comes up after `registry` is healthy.
6. `prometheus`, `grafana`, `otel-collector`, `jaeger` start in parallel from the beginning.

Total time on a warm cache: ~2 minutes. From scratch (image pulls + builds): ~10–15 minutes.

## Configuration

All services read `process.env.*` via `loadConfig()` in `src/config.ts`. Compose passes them via the `environment:` block. The defaults shipped in `docker-compose.phase6.yaml` are dev-grade; for production:

| Variable | Default | Production value |
|---|---|---|
| `LOG_LEVEL` | `info` | `info` (or `warn`) |
| `CORS_ORIGINS` | `http://localhost:3000` | exact frontend origin(s) |
| `KEYCLOAK_REALM_URL` | `http://localhost:8281/realms/urule` | external Keycloak URL |
| `SKIP_AUTH` | (unset; `true` in the local compose) | leave **unset** — `true` bypasses JWT validation entirely (admin mock user). The auth middleware now *fails closed* by default (401s when JWKS is unreachable), so there's no separate `AUTH_FAIL_CLOSED` flag any more. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` | leave (in-cluster OTLP) |
| `OTEL_DISABLED` | (unset) | leave unset (`true` only in tests) |
| `DATABASE_URL` (per service) | `postgres://urule:${POSTGRES_PASSWORD}@postgres:5432/<db>` | external managed Postgres URL |
| `NATS_URL` | `nats://nats:4222` | dedicated NATS cluster URL |
| `TEMPORAL_ADDRESS` | `temporal:7233` | dedicated Temporal cluster |

**Secrets**: the compose files require `POSTGRES_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, and `GRAFANA_ADMIN_PASSWORD` via `${VAR:?}` — a service refuses to start if its credential is missing, so there are no insecure defaults baked into the YAML. For local dev, `make infra-up` copies `infra/compose/.env.example` (insecure dev defaults) to `infra/compose/.env` (gitignored). **In production, supply real values** via your secrets manager / orchestrator secrets (Docker secrets, Kubernetes secrets, Vault) — never the dev defaults from `.env.example`. JWT signing keys live in Keycloak, not in this compose stack.

## Reverse-proxy / TLS

The compose file binds services to `0.0.0.0`. In production, terminate TLS at a reverse proxy (nginx, Caddy, Traefik, Cloudflare) in front of:
- `office-ui:3000` — public
- `registry:3001`, `packagehub:3009`, etc. — internal only OR public if mobile clients hit them directly (browser does)
- `keycloak:8281` — public on its own subdomain (recommended)
- `grafana:3030`, `prometheus:9090`, `jaeger:16686` — internal only; if exposed, gate with auth

Keep `:4317` (OTel gRPC), `:4222` (NATS), `:5432` (Postgres), `:7233` (Temporal gRPC), `:8181` (OPA), `:8282/:8283` (OpenFGA) **off the public network** entirely — they have no native auth or rely on shared secrets that aren't TLS-protected.

Example Caddyfile (public-facing only):

```caddy
office.example.com {
  reverse_proxy localhost:3000
}
api.example.com {
  reverse_proxy /api/v1/* localhost:3001
  reverse_proxy /docs* localhost:3001
}
auth.example.com {
  reverse_proxy localhost:8281
}
```

## Logging + log rotation

Every compose service uses an `x-default-logging` anchor that pins the json-file driver with `max-size: 10m`, `max-file: 3`. Logs land in `/var/lib/docker/containers/<id>/<id>-json.log` on the host. For aggregation, run a sidecar or DaemonSet log shipper (Vector, Promtail, Fluent Bit) — Pino's structured JSON (correlation ID, request ID, trace ID, status, duration) is parser-friendly out of the box.

For a development environment, `docker compose logs <svc> -f` is enough. For production, ship to whatever your org uses (Loki, Elasticsearch, CloudWatch, Datadog).

## Resource limits

`deploy.resources.limits` in compose pins each service to `512M memory / 1.0 cpu` (postgres `1G / 1.0`, nats `256M / 1.0`). These are dev-grade. In production, derive from observed `process_resident_memory_bytes` and `rate(process_cpu_seconds_total[5m])` in Prometheus + Grafana (the Urule Services dashboard surfaces both). Conservative starting points:

| Service | Memory | CPU |
|---|---|---|
| postgres | 4-8 G | 2-4 |
| keycloak | 1-2 G | 1-2 |
| temporal + temporal-visibility | 1-2 G each | 1 each |
| Each Urule service | 512M | 0.5-1 |
| office-ui | 1 G | 1 |
| prometheus | 1-2 G (depends on retention) | 1 |
| grafana | 256M | 0.5 |

## Health checks

Every long-running service has a Docker `HEALTHCHECK` hitting `/healthz` every 5–15s. `docker compose ps` reports the column. The healthcheck shape:

```bash
node -e "fetch('http://localhost:<port>/healthz').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"
```

For Kubernetes probes, use `httpGet` against `/healthz` directly (no Node.js wrapper needed). `livenessProbe` and `readinessProbe` can both use the same endpoint; if the service can't respond to a GET, it's neither live nor ready.

## Upgrades

Schema changes ship via Drizzle migrations (`*-migrate` services), so a typical upgrade is:

```bash
git pull
npm --prefix urule install
npm --prefix urule run build:all
docker compose -f infra/compose/docker-compose.phase6.yaml build
docker compose -f infra/compose/docker-compose.phase6.yaml up -d
```

Compose recreates only the services whose image changed. The `*-migrate` containers run automatically before the new image of each service starts. Idempotent — drizzle-kit tracks applied migrations in `drizzle.__drizzle_migrations`.

For *coordinated* upgrades that span multiple services (e.g. an event topic rename), the conventional rollout:
1. Deploy producers that *also* publish the new topic.
2. Deploy consumers that read both old and new.
3. Deploy producers that publish only the new topic.
4. Deploy consumers that read only the new topic (and remove the old subscription).

Steps 1–4 each ship as separate commits; nothing about compose itself enforces this — discipline via PR review.

## Rollback

If a deploy goes bad and the new image is broken, `docker compose down && git checkout <prev-tag> && docker compose up -d` rolls back the runtime. **It does NOT roll back schema migrations** — drizzle-kit is forward-only. If a migration is the problem, restore the database from backup (see [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md)) before re-deploying the previous image.

## Multi-host / scale-out (sketch)

Single-host compose works for ~hundreds of users. Beyond that:
- **Postgres**: move to a managed instance (RDS, Cloud SQL, Crunchy). Per-service databases stay on it; just point `DATABASE_URL` at the managed endpoint.
- **NATS**: 3-node JetStream cluster with `--cluster_listen` + `--routes`. Replication factor for streams.
- **Stateless services**: scale horizontally with a load balancer. Each replica reads `process.env.HOSTNAME` and includes it in logs (Pino does this by default).
- **office-ui**: Next.js standalone build serves fine behind a CDN. Static assets via `next.config.js: output: 'standalone'` (already set).
- **Temporal, Keycloak, OpenFGA**: each has its own scale-out story. See their docs.

A Kubernetes deployment with Helm is the obvious next step for scale-out; tracked in ROADMAP §6.6.

## Troubleshooting

| Symptom | Likely cause | Where to look |
|---|---|---|
| Service stuck in `restarting` | env var missing / unreachable dep | `docker compose logs <svc> --tail 30` |
| Healthcheck fails but `/healthz` works via curl | quoting issue in compose `test:` line | match the canonical CMD-SHELL pattern in existing services |
| `*-migrate` exits with `Permanent error: Unimplemented service` | otel-collector → jaeger version skew (legacy `:14250`) | already fixed; ensure `otel-collector-config.yaml` exporter targets `jaeger:4317` |
| `ERR_MODULE_NOT_FOUND` for `@opentelemetry/...` | standalone repo's lockfile generated without `--install-links` | regenerate: `rm package-lock.json && npm install --install-links` |
| Prometheus shows targets `down` | service not on the compose network OR scrape DNS resolution failed | `docker compose exec prometheus wget -qO- http://<svc>:<port>/metrics` |
| Grafana panels empty | no scrape data yet | wait one full `scrape_interval` (15s); generate load |
| OTel spans not in Jaeger | `OTEL_DISABLED=true` set OR initOtel called *after* Fastify import | check the `import { initOtel }` is the only static import at the top of `src/index.ts`; rest must be dynamic `await import()` |
