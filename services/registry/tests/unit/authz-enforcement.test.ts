import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authzMiddleware } from '@urule/authz-middleware';
import { createMockAuthzClient } from '@urule/authz/testing';
import type { RelationTuple } from '@urule/authz';
import { registerAgentRoutes } from '../../src/routes/agents.routes.js';
import { registerProviderRoutes } from '../../src/routes/providers.routes.js';
import { registerWorkspaceRoutes } from '../../src/routes/workspaces.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';

/* ------------------------------------------------------------------ *
 * PR B2 — verify requireMembership enforcement on registry write
 * routes: non-member 403, member 2xx, `admin` realm-role bypass, and
 * unknown-resource 404. A custom onRequest hook stands in for
 * @urule/auth-middleware so each test can pick the request's user.
 * ------------------------------------------------------------------ */

type TestUser = { id: string; username?: string; roles?: string[] } | null;

interface MockBehavior {
  selects?: unknown[][];
  inserts?: unknown[][];
  deletes?: unknown[][];
  updates?: unknown[][];
}

function makeMockDb(behavior: MockBehavior = {}) {
  let s = 0, i = 0, d = 0, u = 0;
  return {
    select: vi.fn(() => {
      const rows = behavior.selects?.[s++] ?? [];
      const result = Promise.resolve(rows);
      const fromRet = { where: vi.fn(() => result), limit: vi.fn(() => result) };
      return { from: vi.fn(() => fromRet) };
    }),
    insert: vi.fn(() => {
      const rows = behavior.inserts?.[i++] ?? [];
      return {
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(rows)),
          then: (cb: (v: unknown) => unknown) => Promise.resolve(undefined).then(cb),
        })),
      };
    }),
    update: vi.fn(() => {
      const rows = behavior.updates?.[u++] ?? [];
      return {
        set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(rows)) })) })),
      };
    }),
    delete: vi.fn(() => {
      const rows = behavior.deletes?.[d++] ?? [];
      return { where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(rows)) })) };
    }),
  } as never;
}

async function buildApp(opts: {
  user: TestUser;
  tuples?: RelationTuple[];
  behavior?: MockBehavior;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Stand in for @urule/auth-middleware — decorate the chosen user.
  app.decorateRequest('uruleUser', null);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { uruleUser: TestUser }).uruleUser = opts.user;
  });

  const authz = createMockAuthzClient();
  if (opts.tuples) await authz.writeTuples(opts.tuples);
  await app.register(authzMiddleware, { authzClient: authz });
  app.setErrorHandler(errorHandler);

  const db = makeMockDb(opts.behavior);
  registerAgentRoutes(app, db);
  registerProviderRoutes(app, db);
  registerWorkspaceRoutes(app, db);
  return app;
}

const ALICE = { id: 'alice', username: 'alice' };
const BOB = { id: 'bob', username: 'bob' };
const ROOT = { id: 'root', username: 'root', roles: ['admin'] };

describe('PR B2 — requireMembership on registry write routes', () => {
  it('POST /agents — 403 for a non-member of the target workspace', async () => {
    const app = await buildApp({ user: BOB }); // no tuples
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      payload: { workspaceId: 'ws-1', name: 'Helper' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('POST /agents — 201 for a workspace member', async () => {
    const app = await buildApp({
      user: ALICE,
      tuples: [{ user: 'user:alice', relation: 'member', object: 'workspace:ws-1' }],
      behavior: {
        inserts: [[{ id: 'a1', workspaceId: 'ws-1', name: 'Helper', config: {}, status: 'idle', skillPacks: [], mcpBindings: [], createdAt: new Date(), updatedAt: new Date() }]],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      payload: { workspaceId: 'ws-1', name: 'Helper' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST /agents — 201 for an `admin` user with no tuples (bypass)', async () => {
    const app = await buildApp({
      user: ROOT,
      behavior: {
        inserts: [[{ id: 'a1', workspaceId: 'ws-1', name: 'Helper', config: {}, status: 'idle', skillPacks: [], mcpBindings: [], createdAt: new Date(), updatedAt: new Date() }]],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      payload: { workspaceId: 'ws-1', name: 'Helper' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('PATCH /agents/:agentId — 404 when the agent does not exist', async () => {
    // agentWorkspaceResolver looks the agent up; [] → null → 404, no leak.
    const app = await buildApp({ user: ALICE, behavior: { selects: [[]] } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/agents/missing',
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('DELETE /providers/:providerId — 403 for a non-member', async () => {
    // resolver select → provider's workspace; non-member → 403.
    const app = await buildApp({ user: BOB, behavior: { selects: [[{ workspaceId: 'ws-1' }]] } });
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/providers/p1' });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /providers/:providerId — 204 for a member', async () => {
    const app = await buildApp({
      user: ALICE,
      tuples: [{ user: 'user:alice', relation: 'member', object: 'workspace:ws-1' }],
      behavior: { selects: [[{ workspaceId: 'ws-1' }]], deletes: [[{ id: 'p1', name: 'P' }]] },
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/providers/p1' });
    expect(res.statusCode).toBe(204);
  });

  it('POST /workspaces — 403 for a non-member of the parent org', async () => {
    const app = await buildApp({ user: BOB });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { orgId: 'org-1', name: 'Team', slug: 'team' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.message).toContain('org:org-1');
  });

  it('POST /workspaces — 201 for an org member', async () => {
    const app = await buildApp({
      user: ALICE,
      tuples: [{ user: 'user:alice', relation: 'member', object: 'org:org-1' }],
      behavior: {
        inserts: [[{ id: 'w1', orgId: 'org-1', name: 'Team', slug: 'team', status: 'active', createdAt: new Date(), updatedAt: new Date() }]],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { orgId: 'org-1', name: 'Team', slug: 'team' },
    });
    expect(res.statusCode).toBe(201);
  });
});
