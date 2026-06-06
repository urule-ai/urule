import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authzMiddleware } from '@urule/authz-middleware';
import { createMockAuthzClient } from '@urule/authz/testing';
import type { RelationTuple } from '@urule/authz';
import { registerAgentRoutes } from '../../src/routes/agents.routes.js';
import { registerRuntimeRoutes } from '../../src/routes/runtimes.routes.js';
import { registerWorkspaceRoutes } from '../../src/routes/workspaces.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { agents } from '../../src/db/schema/agents.js';
import { providers } from '../../src/db/schema/providers.js';
import { runtimes } from '../../src/db/schema/runtimes.js';
import { workspaces } from '../../src/db/schema/workspaces.js';

/* ------------------------------------------------------------------ *
 * #4 — the workspace-scoped READ routes were ungated: any authenticated
 * user could read another workspace's agents / runtimes / metadata just
 * by changing `:wsId` (a read-IDOR). They now require membership of the
 * addressed workspace. This locks the gate on all three.
 * (`GET /workspaces/current` is a separate static route and is NOT gated
 * here — office-ui's useWorkspaceId depends on it.)
 * ------------------------------------------------------------------ */

type TestUser = { id: string; username?: string; roles?: string[] } | null;

/** Drizzle-ish mock: agents/runtimes lists resolve empty; workspace lookup
 *  resolves to a row so the detail handler returns 200 for an allowed caller. */
function makeMockDb() {
  const wsRow = { id: 'ws-1', orgId: 'org-1', name: 'Team', slug: 'team', status: 'active' };
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === workspaces) return { where: () => Promise.resolve([wsRow]) };
        if (table === agents) return { where: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }) };
        if (table === providers) return { where: () => Promise.resolve([]) };
        if (table === runtimes) return { where: () => Promise.resolve([]) };
        return { where: () => Promise.resolve([]) };
      },
    }),
  } as never;
}

async function buildApp(opts: { user: TestUser; tuples?: RelationTuple[] }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorateRequest('uruleUser', null);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { uruleUser: TestUser }).uruleUser = opts.user;
  });

  const authz = createMockAuthzClient();
  if (opts.tuples) await authz.writeTuples(opts.tuples);
  await app.register(authzMiddleware, { authzClient: authz });
  app.setErrorHandler(errorHandler);

  const db = makeMockDb();
  registerAgentRoutes(app, db);
  registerRuntimeRoutes(app, db);
  registerWorkspaceRoutes(app, db);
  await app.ready();
  return app;
}

const ALICE = { id: 'alice', username: 'alice' };
const BOB = { id: 'bob', username: 'bob' };
const ROOT = { id: 'root', username: 'root', roles: ['admin'] };
const MEMBER_TUPLE: RelationTuple[] = [{ user: 'user:alice', relation: 'member', object: 'workspace:ws-1' }];

const ROUTES = [
  { name: 'agents', url: '/api/v1/workspaces/ws-1/agents' },
  { name: 'runtimes', url: '/api/v1/workspaces/ws-1/runtimes' },
  { name: 'workspace detail', url: '/api/v1/workspaces/ws-1' },
] as const;

describe('workspace-scoped read routes — membership gate (#4)', () => {
  for (const route of ROUTES) {
    describe(`GET ${route.url} (${route.name})`, () => {
      it('403 for a non-member', async () => {
        const app = await buildApp({ user: BOB }); // no membership tuple
        const res = await app.inject({ method: 'GET', url: route.url });
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
      });

      it('401 when unauthenticated', async () => {
        const app = await buildApp({ user: null });
        const res = await app.inject({ method: 'GET', url: route.url });
        expect(res.statusCode).toBe(401);
      });

      it('200 for a workspace member', async () => {
        const app = await buildApp({ user: ALICE, tuples: MEMBER_TUPLE });
        const res = await app.inject({ method: 'GET', url: route.url });
        expect(res.statusCode).toBe(200);
      });

      it('200 for an `admin` user with no membership tuple (realm-role bypass)', async () => {
        const app = await buildApp({ user: ROOT });
        const res = await app.inject({ method: 'GET', url: route.url });
        expect(res.statusCode).toBe(200);
      });
    });
  }
});
