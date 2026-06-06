import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authMiddleware } from '@urule/auth-middleware';
import { registerAgentRoutes } from '../../src/routes/agents.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { agents } from '../../src/db/schema/agents.js';
import { providers } from '../../src/db/schema/providers.js';

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

// The office-ui moved its agent queries onto the workspace-scoped list (#95).
// That path must return the SAME provider-decorated shape as the admin list —
// several UI sites read `agent.model_provider.provider`, so a bare row (no
// `model_provider`) would crash them. This locks the decoration in.
describe('GET /api/v1/workspaces/:wsId/agents — provider decoration (#95)', () => {
  const agentRow = {
    id: 'a1', workspaceId: 'ws-1', name: 'Ada', status: 'idle',
    config: { provider_id: 'p1' },
  };
  const providerRow = {
    id: 'p1', workspaceId: 'ws-1', name: 'OpenAI', provider: 'openai',
    modelName: 'gpt-4o', baseUrl: '', isDefault: true, isActive: true,
  };
  // Drizzle-ish mock: agents list resolves via `.where().limit().offset()`;
  // the per-agent provider lookup resolves via `.where()` (awaited directly).
  const mockDbWithProvider = {
    select: () => ({
      from: (table: unknown) => {
        if (table === providers) {
          return { where: () => Promise.resolve([providerRow]) };
        }
        return { where: () => ({ limit: () => ({ offset: () => Promise.resolve([agentRow]) }) }) };
      },
    }),
  } as never;

  it('decorates each agent with its model_provider', async () => {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(authMiddleware, { skipAuth: true }); // mock admin — the scoped route is membership-gated (#4); admin bypasses it. Gate itself is covered in workspace-scoped-read-guard.test.ts.
    app.setErrorHandler(errorHandler);
    registerAgentRoutes(app, mockDbWithProvider);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/workspaces/ws-1/agents' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].model_provider).not.toBeNull();
    expect(body[0].model_provider.provider).toBe('openai');
  });
});
