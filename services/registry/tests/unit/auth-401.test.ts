import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { authMiddleware } from '@urule/auth-middleware';

// Mirror registry's server.ts publicRoutes config. Drift in either direction
// shows up here. Registry is the only service that exposes /auth/login as a
// public endpoint (login flow can't require an existing token).
const PUBLIC_ROUTES = ['/healthz', '/api/v1/infrastructure', '/auth/login', '/docs'];

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
  app.get('/api/v1/infrastructure/status', async () => ({ ok: true }));
  app.post('/auth/login', async () => ({ token: 'stub' }));
  app.post('/api/v1/orgs', async () => ({ id: 'o1' }));
  return app;
}

describe('registry — fail-closed auth wiring', () => {
  it('returns 401 on a protected route with no auth header', async () => {
    const app = await buildAuthClosedApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/orgs', payload: {} });
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

  it('keeps /api/v1/infrastructure/* accessible (bootstrap probe)', async () => {
    const app = await buildAuthClosedApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/infrastructure/status' });
    expect(res.statusCode).toBe(200);
  });

  it('keeps /auth/login accessible (login flow has no token yet)', async () => {
    const app = await buildAuthClosedApp();
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: {} });
    expect(res.statusCode).toBe(200);
  });
});
