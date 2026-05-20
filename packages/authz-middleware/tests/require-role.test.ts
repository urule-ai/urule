import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requireRole } from '../src/require-role.js';

interface TestUser {
  id: string;
  roles: string[];
}

async function buildApp(user: TestUser | null, role: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('uruleUser', null);
  app.addHook('onRequest', async (request) => {
    (request as import('fastify').FastifyRequest & { uruleUser: TestUser | null }).uruleUser = user;
  });
  app.get('/api/v1/admin-only', { preHandler: requireRole(role) }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('@urule/authz-middleware — requireRole', () => {
  it('allows the request when the user has the required role', async () => {
    const app = await buildApp({ id: 'alice', roles: ['admin', 'user'] }, 'admin');
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin-only' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when the user does not have the role', async () => {
    const app = await buildApp({ id: 'alice', roles: ['user'] }, 'admin');
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin-only' });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('admin');
  });

  it('returns 403 when there is no authenticated user', async () => {
    const app = await buildApp(null, 'admin');
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin-only' });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when the user has no roles array', async () => {
    const app = await buildApp({ id: 'alice', roles: [] }, 'admin');
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin-only' });
    expect(res.statusCode).toBe(403);
  });
});
