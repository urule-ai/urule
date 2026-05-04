import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

export interface MetricsPluginOptions {
  /**
   * Path the `/metrics` endpoint is exposed at. Default `/metrics`.
   */
  endpoint?: string;
  /**
   * Optional service name added as a `service` label on every metric.
   * Useful when scraping from a single Prometheus instance across services.
   */
  serviceName?: string;
}

async function metricsPluginFn(app: FastifyInstance, opts: MetricsPluginOptions = {}) {
  const endpoint = opts.endpoint ?? '/metrics';
  const labels: Record<string, string> = opts.serviceName ? { service: opts.serviceName } : {};

  // Each plugin instance gets its own registry so multiple Fastify apps in the
  // same process (e.g. tests) don't collide.
  const register = new Registry();
  if (Object.keys(labels).length > 0) {
    register.setDefaultLabels(labels);
  }
  collectDefaultMetrics({ register });

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests handled',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  const httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
  });

  app.addHook('onResponse', async (request, reply) => {
    // routerPath/routeOptions.url is set by Fastify after routing; falls back
    // to request.url for unmatched routes (e.g. 404s) — but we use the
    // matched-route version when available so cardinality stays bounded.
    const route = request.routeOptions?.url ?? 'unmatched';
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };
    httpRequestsTotal.inc(labels);
    const elapsed = reply.elapsedTime / 1000;
    httpRequestDurationSeconds.observe(labels, elapsed);
  });

  app.get(endpoint, async (_request, reply) => {
    reply.header('content-type', register.contentType);
    return register.metrics();
  });
}

export const metricsPlugin = fp(metricsPluginFn, {
  name: '@urule/observability:metrics',
  fastify: '5.x',
});
