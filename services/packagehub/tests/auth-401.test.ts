import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { authMiddleware } from '@urule/auth-middleware';

// Mirror packagehub's server.ts publicRoutes config. /api/v1/packages is
// public so anonymous users can browse the catalog (read-only); writes
// (publish, version bumps) hit other routes that ARE protected.
const PUBLIC_ROUTES = ['/healthz', '/api/v1/packages', '/docs'];

async function buildAuthClosedApp() {
  const app = Fastify({ logger: false });
  await app.register(authMiddleware, {
    // Pin skipAuth:false so the package-level SKIP_AUTH=true (vitest.config) is
    // overridden — JWKS is unreachable, so the middleware fails closed.
    skipAuth: false,
    jwksUrl: 'http://localhost:99999/nonexistent',
    publicRoutes: PUBLIC_ROUTES,
  });
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/docs/json', async () => ({ openapi: '3.0' }));
  app.get('/api/v1/packages', async () => []);
  app.get('/api/v1/packages/some-pkg', async () => ({ id: 'p1' }));
  app.post('/api/v1/admin/reindex', async () => ({ ok: true }));
  return app;
}

describe('packagehub — fail-closed auth wiring', () => {
  it('returns 401 on a protected route with no auth header', async () => {
    const app = await buildAuthClosedApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/reindex', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('keeps /healthz accessible (k8s liveness probe)', async () => {
    const app = await buildAuthClosedApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });

  it('keeps /docs/* accessible (Swagger UI)', async () => {
    const app = await buildAuthClosedApp();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
  });

  it('keeps /api/v1/packages and its sub-paths public (catalog browse)', async () => {
    const app = await buildAuthClosedApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/packages' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/packages/some-pkg' })).statusCode).toBe(200);
  });
});
