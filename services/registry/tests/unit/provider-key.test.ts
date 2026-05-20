import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authMiddleware } from '@urule/auth-middleware';
import { registerProviderRoutes } from '../../src/routes/providers.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';

// `GET /api/v1/providers/:id/key` returns the UNMASKED LLM key. It is admin-gated
// (#5) — without the gate any authenticated user could exfiltrate any provider's
// key. The route fixtures register auth in skipAuth mode (which yields the admin
// mock user); for the non-admin / anonymous cases we override `request.uruleUser`
// with a post-auth onRequest hook.

const PROVIDER_ROW = {
  id: 'p1',
  workspaceId: 'w1',
  name: 'Anthropic',
  provider: 'anthropic',
  apiKey: 'sk-ant-test-secret-key',
  modelName: 'claude-sonnet-4-6',
  baseUrl: null,
  isDefault: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function mockDb(rows: unknown[]) {
  // Minimal Drizzle shape — only `select().from().where()` is exercised by /key.
  return { select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }) } as never;
}

async function buildApp(roles: string[] | null, rows: unknown[] = [PROVIDER_ROW]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(authMiddleware, { skipAuth: true });
  if (!(roles && roles.includes('admin'))) {
    // Override the mock admin user so the test runs as a non-admin (or anon).
    app.addHook('onRequest', async (req) => {
      (req as unknown as { uruleUser: unknown }).uruleUser =
        roles === null ? null : { id: 'u1', username: 'regular', email: 'r@example.io', name: 'Regular', roles };
    });
  }
  app.setErrorHandler(errorHandler);
  registerProviderRoutes(app, mockDb(rows));
  await app.ready();
  return app;
}

describe('GET /api/v1/providers/:providerId/key — admin gate (#5)', () => {
  it('returns 403 for a non-admin user', async () => {
    const app = await buildApp(['user']);
    const res = await app.inject({ method: 'GET', url: '/api/v1/providers/p1/key' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('returns 403 when there is no authenticated user', async () => {
    const app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/api/v1/providers/p1/key' });
    expect(res.statusCode).toBe(403);
  });

  it('returns the unmasked key for an admin', async () => {
    const app = await buildApp(['admin']);
    const res = await app.inject({ method: 'GET', url: '/api/v1/providers/p1/key' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      apiKey: 'sk-ant-test-secret-key',
      provider: 'anthropic',
      modelName: 'claude-sonnet-4-6',
    });
  });

  it('still 404s for an unknown provider (admin)', async () => {
    const app = await buildApp(['admin'], []);
    const res = await app.inject({ method: 'GET', url: '/api/v1/providers/nope/key' });
    expect(res.statusCode).toBe(404);
  });
});
