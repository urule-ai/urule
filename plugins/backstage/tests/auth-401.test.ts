import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { authMiddleware } from '@urule/auth-middleware';

// Mirror backstage plugin's server.ts publicRoutes config. Drift in either
// direction shows up here.
const PUBLIC_ROUTES = ['/healthz', '/docs'];

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
  app.get('/catalog/entities', async () => []);
  return app;
}

describe('backstage plugin — fail-closed auth wiring', () => {
  it('returns 401 on a protected route with no auth header', async () => {
    const app = await buildAuthClosedApp();
    const res = await app.inject({ method: 'GET', url: '/catalog/entities' });
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
});
