import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { registerEntitlementRoutes } from '../src/routes/entitlements.routes.js';

/* ------------------------------------------------------------------ *
 * Phase L — C-11 fix on packagehub entitlements.
 *
 * Previously POST /api/v1/entitlements and DELETE /:id were JWT-auth
 * only, so any authenticated user could mint paid entitlements for
 * themselves (revenue loss) or revoke someone else's (DoS). Now
 * both require the `admin` realm role; the Stripe webhook bypasses
 * the HTTP route entirely and writes directly to the DB (see
 * webhooks.routes.ts), so HTTP-path admin-only doesn't break the
 * purchase flow.
 *
 * GET /api/v1/entitlements stays open — it's the install gate
 * consulted by the packages service before installing a package.
 *
 * No authzMiddleware needed: requireRole is a pure JWT roles check.
 * A custom onRequest hook stands in for @urule/auth-middleware.
 * ------------------------------------------------------------------ */

type TestUser = { id: string; roles?: string[] } | null;

interface MockDbOpts {
  selectRows?: unknown[][];
  insertRows?: unknown[][];
  deleteRows?: unknown[][];
}

function makeMockDb(opts: MockDbOpts) {
  let s = 0, i = 0, d = 0;
  const captured: { insertValues: unknown[] } = { insertValues: [] };
  const db = {
    select: vi.fn(() => {
      const rows = opts.selectRows?.[s++] ?? [];
      return { from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(rows)) })) };
    }),
    insert: vi.fn(() => {
      const rows = opts.insertRows?.[i++] ?? [];
      return {
        values: vi.fn((v: unknown) => {
          captured.insertValues.push(v);
          return {
            returning: vi.fn(() => Promise.resolve(rows)),
            then: (cb: (x: unknown) => unknown) => Promise.resolve(undefined).then(cb),
          };
        }),
      };
    }),
    delete: vi.fn(() => {
      const rows = opts.deleteRows?.[d++] ?? [];
      return {
        where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(rows)) })),
      };
    }),
  };
  return { db: db as never, captured };
}

async function buildApp(opts: { user: TestUser } & MockDbOpts): Promise<{
  app: FastifyInstance;
  captured: { insertValues: unknown[] };
}> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('uruleUser', null);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { uruleUser: TestUser }).uruleUser = opts.user;
  });

  const { db, captured } = makeMockDb(opts);
  registerEntitlementRoutes(app, db);
  await app.ready();
  return { app, captured };
}

const ADMIN: TestUser = { id: 'root', roles: ['admin'] };
const MEMBER: TestUser = { id: 'alice', roles: ['member'] };
const ROLELESS: TestUser = { id: 'noroles' };
const ANON: TestUser = null;

const GRANT_PAYLOAD = {
  packageName: '@vendor/premium',
  workspaceId: 'ws-1',
  kind: 'grant' as const,
};

describe('Phase L — C-11 entitlement admin-only authz', () => {
  describe('POST /api/v1/entitlements', () => {
    it('non-admin authenticated user → 403 (C-11 regression)', async () => {
      const { app } = await buildApp({ user: MEMBER });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/entitlements',
        payload: GRANT_PAYLOAD,
      });
      expect(res.statusCode).toBe(403);
    });

    it('roleless authenticated user → 403', async () => {
      const { app } = await buildApp({ user: ROLELESS });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/entitlements',
        payload: GRANT_PAYLOAD,
      });
      expect(res.statusCode).toBe(403);
    });

    it('unauthenticated → 403 (requireRole denies when uruleUser is null)', async () => {
      // In production, auth-middleware short-circuits with 401 first; this
      // exercises requireRole in isolation as defense-in-depth.
      const { app } = await buildApp({ user: ANON });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/entitlements',
        payload: GRANT_PAYLOAD,
      });
      expect(res.statusCode).toBe(403);
    });

    it('admin → 201 + entitlement minted', async () => {
      const { app, captured } = await buildApp({
        user: ADMIN,
        selectRows: [
          [{ id: 'pkg-1', name: '@vendor/premium' }], // package lookup
          [], // idempotency lookup — no existing row
        ],
        insertRows: [[{ id: 'ent-1', packageId: 'pkg-1', kind: 'grant' }]],
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/entitlements',
        payload: GRANT_PAYLOAD,
      });
      expect(res.statusCode).toBe(201);
      expect(captured.insertValues).toHaveLength(1);
    });
  });

  describe('DELETE /api/v1/entitlements/:id', () => {
    it('non-admin authenticated user → 403 (C-11 regression)', async () => {
      const { app } = await buildApp({ user: MEMBER });
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/entitlements/ent-1',
      });
      expect(res.statusCode).toBe(403);
    });

    it('admin → 204', async () => {
      const { app } = await buildApp({
        user: ADMIN,
        deleteRows: [[{ id: 'ent-1' }]],
      });
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/entitlements/ent-1',
      });
      expect(res.statusCode).toBe(204);
    });

    it('admin DELETE on unknown id → 404 (leak-safe semantics preserved)', async () => {
      const { app } = await buildApp({
        user: ADMIN,
        deleteRows: [[]], // no row returned — already revoked / unknown
      });
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/entitlements/nope',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/entitlements (open — install gate, not behind admin)', () => {
    it('non-admin can still check entitlements (install gate)', async () => {
      const { app } = await buildApp({
        user: MEMBER,
        selectRows: [
          [{ id: 'pkg-1', name: '@vendor/premium', licenseTier: 'paid' }],
          [], // no entitlement → returns allowed:false
        ],
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/entitlements?packageName=@vendor/premium&workspaceId=ws-1',
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
