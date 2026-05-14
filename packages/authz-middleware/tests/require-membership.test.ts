import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createMockAuthzClient } from '@urule/authz/testing';
import type { AuthzClient, RelationTuple } from '@urule/authz';
import { authzMiddleware } from '../src/plugin.js';
import { requireMembership } from '../src/require-membership.js';

interface TestUser {
  id: string;
  roles?: string[];
}

interface BuildAppOpts {
  user?: TestUser | null;
  tuples?: RelationTuple[];
  /** Override the route's workspace-id resolver. Defaults to `(req) => (req.body as any).workspaceId`. */
  getWorkspaceId?: (request: import('fastify').FastifyRequest) => string | null | Promise<string | null>;
  /** Required relation; defaults to `member`. */
  relation?: string;
}

async function buildApp(opts: BuildAppOpts = {}): Promise<{ app: FastifyInstance; authz: AuthzClient }> {
  const app = Fastify({ logger: false });
  const authz = createMockAuthzClient();
  if (opts.tuples) await authz.writeTuples(opts.tuples);

  // Stand in for @urule/auth-middleware in skipAuth mode: decorate uruleUser
  // with whatever the test wants (null, regular user, admin).
  app.decorateRequest('uruleUser', null);
  const user = opts.user === undefined ? { id: 'dev-user-001', roles: ['admin'] } : opts.user;
  app.addHook('onRequest', async (request) => {
    (request as import('fastify').FastifyRequest & { uruleUser: TestUser | null }).uruleUser = user;
  });

  await app.register(authzMiddleware, { authzClient: authz });

  const resolver =
    opts.getWorkspaceId ?? ((req) => (req.body as { workspaceId?: string } | null)?.workspaceId ?? null);

  app.post(
    '/api/v1/resources',
    { preHandler: requireMembership(resolver, opts.relation ? { relation: opts.relation } : undefined) },
    async () => ({ ok: true }),
  );

  await app.ready();
  return { app, authz };
}

describe('@urule/authz-middleware — requireMembership', () => {
  it('allows the request when the user is a workspace member', async () => {
    const { app } = await buildApp({
      user: { id: 'alice' },
      tuples: [{ user: 'user:alice', relation: 'member', object: 'workspace:ws-1' }],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      payload: { workspaceId: 'ws-1' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when the user is not a member of the target workspace', async () => {
    const { app } = await buildApp({
      user: { id: 'alice' },
      tuples: [{ user: 'user:alice', relation: 'member', object: 'workspace:ws-1' }],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      payload: { workspaceId: 'ws-2' },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('workspace:ws-2');
    expect(body.error.message).toContain('member');
  });

  it('returns 401 when there is no authenticated user', async () => {
    const { app } = await buildApp({ user: null });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      payload: { workspaceId: 'ws-1' },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 404 when the resolver returns null (resource not found)', async () => {
    const { app } = await buildApp({
      user: { id: 'alice' },
      getWorkspaceId: () => null,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('supports a custom relation (e.g., admin) for stricter gates', async () => {
    const { app } = await buildApp({
      user: { id: 'alice' },
      tuples: [{ user: 'user:alice', relation: 'member', object: 'workspace:ws-1' }],
      relation: 'admin',
    });
    // The user is `member`, not `admin` → 403 even though they're in the workspace.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      payload: { workspaceId: 'ws-1' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.message).toContain('admin');
  });

  it('supports an async resolver (e.g., DB lookup)', async () => {
    const { app } = await buildApp({
      user: { id: 'alice' },
      tuples: [{ user: 'user:alice', relation: 'member', object: 'workspace:ws-async' }],
      getWorkspaceId: async () => {
        await new Promise((r) => setImmediate(r));
        return 'ws-async';
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resources',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });
});
