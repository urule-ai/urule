# Observability

Three signals: traces, metrics, logs.

| Signal | Producer | Pipeline | Backend | UI |
|---|---|---|---|---|
| Traces | services (via `@urule/observability` `initOtel`) | OTLP gRPC → otel-collector | Jaeger | http://localhost:16686 |
| Metrics | services (via `@urule/observability` `metricsPlugin`) | scraped from `/metrics` | Prometheus | http://localhost:9090 |
| Logs | services (Pino) | docker logs / log driver | (any aggregator) | `docker compose logs <svc>` |

A correlation ID (`x-correlation-id` header) is minted in office-ui, propagated end-to-end by `@urule/correlation-id`, tagged on every Pino log line via `request.id`, and rides over NATS via the message header. OTel auto-instrumentation adds W3C `traceparent` propagation; the two are independent and complementary — correlation ID is human-friendly, trace ID is for Jaeger.

## Local stack

`docker compose -f infra/compose/docker-compose.phase6.yaml up -d` brings up the full stack with all observability components. Default ports:

| Service | URL | Auth |
|---|---|---|
| Grafana | http://localhost:3030 | anonymous Viewer (read-only); admin / urule for edits |
| Prometheus | http://localhost:9090 | none |
| Jaeger | http://localhost:16686 | none |

The Grafana dashboard `Urule Services` (auto-provisioned from [grafana-dashboard-services.json](../infra/compose/grafana-dashboard-services.json)) shows per-service request rate, p95 latency, error rate, event-loop lag, RSS memory, and CPU.

## /metrics endpoint

Every service exposes `GET /metrics` (Prometheus exposition format) on its main HTTP port. Unauthenticated — added to the auth middleware's `publicRoutes` list automatically. Metrics include:

- `http_requests_total{method, route, status_code, service}` — counter
- `http_request_duration_seconds_bucket{...}` — histogram (5ms to 10s buckets)
- `process_*`, `nodejs_*` — defaults from `prom-client` (CPU, RSS, event-loop lag, GC)

The `service` label is the default label set when registering the plugin — used by Prometheus to disambiguate counters across the matrix of running services.

## OpenTelemetry traces

`initOtel(serviceName)` is called once at process startup, *before* importing Fastify, so auto-instrumentations can patch the HTTP layer at module-load time. The SDK exports OTLP gRPC traces to `process.env.OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://otel-collector:4317`), which the collector forwards to Jaeger.

Cross-service propagation is automatic: HTTP auto-instrumentation injects `traceparent` headers on outbound requests and reads them on inbound. No manual instrumentation is required for HTTP boundaries.

To view a trace: open Jaeger, pick the service from the dropdown, and a multi-span trace tracks the request through every service hop.

To disable OTel locally (skip the SDK init, no spans flow): set `OTEL_DISABLED=true` in the environment.

## Adding a custom metric

```ts
import { Counter, register } from 'prom-client';

const myCounter = new Counter({
  name: 'my_thing_total',
  help: 'Description of what this counts',
  labelNames: ['workspace_id'],
});

myCounter.inc({ workspace_id });
```

Note: the metrics plugin uses its own `Registry`, not the global `register`. To attach a custom metric to a service's /metrics output, accept the registry from the plugin or use the same custom-registry pattern. For cross-cutting concerns the global `prom-client` register works if you also expose it via a separate /metrics-app endpoint.

## Adding a custom span

```ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('@urule/registry');
await tracer.startActiveSpan('expensive-computation', async (span) => {
  try {
    const result = await doExpensiveThing();
    span.setAttribute('result.count', result.length);
    return result;
  } finally {
    span.end();
  }
});
```

Auto-instrumentation already covers HTTP servers, HTTP clients (incl. `fetch`), `pg` (Postgres queries), and Node's built-in `dns`/`net`. Add custom spans only for business-meaningful boundaries that aren't already covered.

## Scraping additional services

Add the service to [infra/compose/prometheus.yml](../infra/compose/prometheus.yml) under `urule-services.static_configs.targets`. Prometheus auto-reloads on config changes (in fact, on container restart — `docker compose restart prometheus`).

For services running outside compose, add a separate `static_configs` entry pointing at the service's host:port — Prometheus follows `/metrics` by default, no extra config needed.

## Troubleshooting

- **`/metrics` returns 401**: `/metrics` not in the service's `publicRoutes`. Check `app.register(authMiddleware, { publicRoutes: [..., '/metrics', ...] })`.
- **Prometheus shows target as `down`**: target hostname unresolvable from prometheus container. The host should be the compose service name (e.g. `registry:3000`, not `localhost:3001`).
- **Jaeger shows no traces**: the service's process didn't call `initOtel(serviceName)` before importing Fastify, OR `OTEL_DISABLED=true` is set. Check the service's `src/index.ts` (entrypoint).
- **Grafana dashboard panels are empty**: usually means Prometheus has no data for that metric yet — generate some load (`for i in {1..50}; do curl -s http://localhost:3001/healthz; done`) and wait the 15s scrape interval.
