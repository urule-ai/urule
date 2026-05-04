import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { metricsPlugin } from '../src/metrics.js';

describe('@urule/observability — metrics', () => {
  it('exposes /metrics returning Prometheus text format', async () => {
    const app = Fastify({ logger: false });
    await app.register(metricsPlugin);
    app.get('/healthz', async () => ({ ok: true }));

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.body).toContain('# HELP process_cpu_seconds_total');
    expect(res.body).toContain('# HELP http_requests_total');
  });

  it('http_requests_total increments after a request to another route', async () => {
    const app = Fastify({ logger: false });
    await app.register(metricsPlugin);
    app.get('/healthz', async () => ({ ok: true }));

    // Trigger a request so onResponse fires
    await app.inject({ method: 'GET', url: '/healthz' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.body).toMatch(/http_requests_total\{[^}]*route="\/healthz"[^}]*status_code="200"[^}]*\}\s+1/);
  });

  it('records duration histogram observations', async () => {
    const app = Fastify({ logger: false });
    await app.register(metricsPlugin);
    app.get('/healthz', async () => ({ ok: true }));

    await app.inject({ method: 'GET', url: '/healthz' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.body).toContain('http_request_duration_seconds_bucket');
    expect(res.body).toContain('http_request_duration_seconds_sum');
    expect(res.body).toContain('http_request_duration_seconds_count');
  });

  it('adds the `service` default label when serviceName is provided', async () => {
    const app = Fastify({ logger: false });
    await app.register(metricsPlugin, { serviceName: 'test-svc' });
    app.get('/healthz', async () => ({ ok: true }));

    await app.inject({ method: 'GET', url: '/healthz' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.body).toMatch(/http_requests_total\{[^}]*service="test-svc"/);
  });

  it('uses a custom endpoint when configured', async () => {
    const app = Fastify({ logger: false });
    await app.register(metricsPlugin, { endpoint: '/internal/metrics' });

    const defaultPath = await app.inject({ method: 'GET', url: '/metrics' });
    expect(defaultPath.statusCode).toBe(404);

    const custom = await app.inject({ method: 'GET', url: '/internal/metrics' });
    expect(custom.statusCode).toBe(200);
    expect(custom.body).toContain('process_cpu_seconds_total');
  });

  it('keeps registries isolated across plugin instances', async () => {
    const app1 = Fastify({ logger: false });
    await app1.register(metricsPlugin);
    app1.get('/foo', async () => ({}));
    await app1.inject({ method: 'GET', url: '/foo' });

    const app2 = Fastify({ logger: false });
    await app2.register(metricsPlugin);
    // No requests on app2 — its counter should be zero.

    const res1 = await app1.inject({ method: 'GET', url: '/metrics' });
    const res2 = await app2.inject({ method: 'GET', url: '/metrics' });

    expect(res1.body).toMatch(/http_requests_total\{[^}]*route="\/foo"[^}]*\}\s+1/);
    expect(res2.body).not.toContain('route="/foo"');
  });
});
