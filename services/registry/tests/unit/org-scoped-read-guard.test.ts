import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authzMiddleware } from '@urule/authz-middleware';
import { createMockAuthzClient } from '@urule/authz/testing';
import type { RelationTuple } from '@urule/authz';
import { registerOrgRoutes } from '../../src/routes/orgs.routes.js';
import { registerWorkspaceRoutes } from '../../src/routes/workspaces.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { orgs } from '../../src/db/schema/orgs.js';
import { workspaces } from '../../src/db/schema/workspaces.js';

/* ------------------------------------------------------------------ *
 * #4 — the org-scoped READ routes were ungated: any authenticated user
 * could read another tenant's org metadata (`GET /orgs/:orgId`) or
 * enumerate its workspace list (`GET /orgs/:orgId/workspaces`) just by
 * changing `:orgId` (a read-IDOR). They now require membership of the
 * addressed ORG. Org membership does NOT flow up from a single workspace,
 * so a plain workspace member is still denied. (The cross-tenant
 * `GET /orgs` and `GET /workspaces` lists stay admin-only.)
 * ------------------------------------------------------------------ */

type TestUser = { id: string; username?: string; roles?: string[] } | null;

/** orgs lookup → one row (so the detail handler 200s for an allowed caller);
 *  workspaces list → empty (a 200 empty array is the documented response). */
function makeMockDb() {
  const orgRow = { id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', createdAt: new Date(), updatedAt: new Date() };
  return {
    select: () => ({
      from: (table: unknown) => {
        const rows = table === orgs ? [orgRow] : table === workspaces ? [] : [];
        return { where: () => Promise.resolve(rows) };
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
  registerOrgRoutes(app, db);
  registerWorkspaceRoutes(app, db);
  await app.ready();
  return app;
}

const ALICE = { id: 'alice', username: 'alice' };
const BOB = { id: 'bob', username: 'bob' };
const ROOT = { id: 'root', username: 'root', roles: ['admin'] };
const ORG_MEMBER: RelationTuple[] = [{ user: 'user:alice', relation: 'member', object: 'org:org-1' }];
// A membership of a workspace INSIDE the org must NOT grant access to the org itself.
const WS_MEMBER: RelationTuple[] = [{ user: 'user:alice', relation: 'member', object: 'workspace:ws-1' }];

const ROUTES = [
  { name: 'org detail', url: '/api/v1/orgs/org-1' },
  { name: 'org workspaces', url: '/api/v1/orgs/org-1/workspaces' },
] as const;

describe('org-scoped read routes — org membership gate (#4)', () => {
  for (const route of ROUTES) {
    describe(`GET ${route.url} (${route.name})`, () => {
      it('403 for a non-member', async () => {
        const app = await buildApp({ user: BOB }); // no tuple
        const res = await app.inject({ method: 'GET', url: route.url });
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
      });

      it('401 when unauthenticated', async () => {
        const app = await buildApp({ user: null });
        const res = await app.inject({ method: 'GET', url: route.url });
        expect(res.statusCode).toBe(401);
      });

      it('403 for a member of a workspace in the org but NOT the org (no upward inheritance)', async () => {
        const app = await buildApp({ user: ALICE, tuples: WS_MEMBER });
        const res = await app.inject({ method: 'GET', url: route.url });
        expect(res.statusCode).toBe(403);
      });

      it('200 for an org member', async () => {
        const app = await buildApp({ user: ALICE, tuples: ORG_MEMBER });
        const res = await app.inject({ method: 'GET', url: route.url });
        expect(res.statusCode).toBe(200);
      });

      it('200 for an `admin` user with no tuple (realm-role bypass)', async () => {
        const app = await buildApp({ user: ROOT });
        const res = await app.inject({ method: 'GET', url: route.url });
        expect(res.statusCode).toBe(200);
      });
    });
  }
});
