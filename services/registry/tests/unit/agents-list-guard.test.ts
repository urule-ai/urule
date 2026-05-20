import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authMiddleware } from '@urule/auth-middleware';
import { registerAgentRoutes } from '../../src/routes/agents.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';

// `GET /api/v1/agents` is the cross-workspace "admin-shaped" list — without a
// guard, any authenticated user saw every workspace's agents (#25). It's now
// admin-only; regular callers use `/api/v1/workspaces/:wsId/agents`. The route
// fixtures register auth in skipAuth mode (admin mock user); for the non-admin /
// anonymous cases we override `request.uruleUser` with a post-auth onRequest hook.

// Minimal Drizzle shape — `select().from().limit().offset()` resolves to [].
// (An empty list is enough; the admin check runs before any DB call.)
const mockDb = {
  select: () => ({ from: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }) }),
} as never;

async function buildApp(roles: string[] | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(authMiddleware, { skipAuth: true });
  if (!(roles && roles.includes('admin'))) {
    app.addHook('onRequest', async (req) => {
      (req as unknown as { uruleUser: unknown }).uruleUser =
        roles === null ? null : { id: 'u1', username: 'regular', email: 'r@example.io', name: 'Regular', roles };
    });
  }
  app.setErrorHandler(errorHandler);
  registerAgentRoutes(app, mockDb);
  await app.ready();
  return app;
}

describe('GET /api/v1/agents — admin gate (#25)', () => {
  it('returns 403 for a non-admin user', async () => {
    const app = await buildApp(['user']);
    const res = await app.inject({ method: 'GET', url: '/api/v1/agents' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('returns 403 when there is no authenticated user', async () => {
    const app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/api/v1/agents' });
    expect(res.statusCode).toBe(403);
  });

  it('returns the list for an admin', async () => {
    const app = await buildApp(['admin']);
    const res = await app.inject({ method: 'GET', url: '/api/v1/agents' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});
