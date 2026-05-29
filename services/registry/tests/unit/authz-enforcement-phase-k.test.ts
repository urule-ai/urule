import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authzMiddleware } from '@urule/authz-middleware';
import { createMockAuthzClient } from '@urule/authz/testing';
import type { RelationTuple } from '@urule/authz';
import { registerConversationRoutes } from '../../src/routes/conversations.routes.js';
import { registerOrgRoutes } from '../../src/routes/orgs.routes.js';
import { registerProviderRoutes } from '../../src/routes/providers.routes.js';
import { registerWorkspaceRoutes } from '../../src/routes/workspaces.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';

/* ------------------------------------------------------------------ *
 * Phase K — close registry's last critical-audit authz hole (C-08) and
 * admin-gate the four remaining cross-workspace list routes (#95).
 *
 * C-08: POST /conversations/:id/messages no longer accepts `senderId`
 * in the body — derived from the JWT subject. Body-passed `senderId`
 * returns 400 (z.strictObject); attempts surface in logs.
 *
 * #95: GET /workspaces, /orgs, /conversations are admin-only.
 * GET /providers is admin-OR-workspaceId-filter (members may scope to
 * their own workspace; cross-workspace requires admin).
 * ------------------------------------------------------------------ */

type TestUser = { id: string; username?: string; roles?: string[] } | null;

interface MockBehavior {
  selects?: unknown[][];
  inserts?: unknown[][];
  deletes?: unknown[][];
  updates?: unknown[][];
}

/**
 * Build a value that's BOTH a Promise resolving to `rows` AND has the
 * Drizzle-style chain methods (`.where`, `.limit`, `.orderBy`) so the
 * route handler can either `await db.select().from(x)` directly OR
 * keep chaining. Each chain step returns the same awaitable so any
 * level of chaining lands on the same canned rows.
 */
function makeChain(rows: unknown[]) {
  const result = Promise.resolve(rows);
  const limitFn = vi.fn(() => Object.assign(Promise.resolve(rows), { offset: vi.fn(() => result) }));
  const orderByFn = vi.fn(() => Object.assign(Promise.resolve(rows), { limit: limitFn }));
  const whereFn = vi.fn(() => Object.assign(Promise.resolve(rows), {
    limit: limitFn,
    orderBy: orderByFn,
  }));
  return Object.assign(result, {
    where: whereFn,
    limit: limitFn,
    orderBy: orderByFn,
  });
}

function makeMockDb(behavior: MockBehavior = {}) {
  let s = 0, i = 0, d = 0, u = 0;
  const captured: { insertValues: unknown[] } = { insertValues: [] };
  return {
    db: {
      select: vi.fn(() => {
        const rows = behavior.selects?.[s++] ?? [];
        return { from: vi.fn(() => makeChain(rows)) };
      }),
      insert: vi.fn(() => {
        const rows = behavior.inserts?.[i++] ?? [];
        return {
          values: vi.fn((v: unknown) => {
            captured.insertValues.push(v);
            return {
              returning: vi.fn(() => Promise.resolve(rows)),
              then: (cb: (v: unknown) => unknown) => Promise.resolve(undefined).then(cb),
            };
          }),
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
    } as never,
    captured,
  };
}

async function buildApp(opts: {
  user: TestUser;
  tuples?: RelationTuple[];
  behavior?: MockBehavior;
}): Promise<{ app: FastifyInstance; captured: { insertValues: unknown[] } }> {
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

  const { db, captured } = makeMockDb(opts.behavior);
  registerConversationRoutes(app, db);
  registerOrgRoutes(app, db);
  registerProviderRoutes(app, db);
  registerWorkspaceRoutes(app, db);
  return { app, captured };
}

const ALICE: TestUser = { id: 'alice', username: 'alice' };
const BOB: TestUser = { id: 'bob', username: 'bob' };
const ROOT: TestUser = { id: 'root', username: 'root', roles: ['admin'] };
const MEMBER_OF_WS1: RelationTuple[] = [
  { user: 'user:alice', relation: 'member', object: 'workspace:ws-1' },
];

describe('Phase K — C-08 identity-spoofing fix on POST /messages', () => {
  it('body with `senderId` is rejected with 400 (strict schema regression)', async () => {
    const { app } = await buildApp({
      user: ALICE,
      tuples: MEMBER_OF_WS1,
      behavior: {
        selects: [
          [{ id: 'conv-1', workspaceId: 'ws-1' }], // conversationWorkspaceResolver lookup
          [{ id: 'conv-1', workspaceId: 'ws-1' }], // handler's existence check
        ],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { senderId: 'eve', content: 'hi' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('clean body (no senderId) records the JWT subject as senderId', async () => {
    const { app, captured } = await buildApp({
      user: ALICE,
      tuples: MEMBER_OF_WS1,
      behavior: {
        selects: [
          [{ id: 'conv-1', workspaceId: 'ws-1' }],
          [{ id: 'conv-1', workspaceId: 'ws-1' }],
          [], // conversationAgents lookup (no agents linked → no LLM call)
        ],
        inserts: [[{ id: 'm-1', conversationId: 'conv-1', senderId: 'alice', senderType: 'user', content: 'hi' }]],
        updates: [[]],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: 'hi' },
    });
    expect(res.statusCode).toBe(201);
    // Captured insert receives senderId from the JWT (alice), not from body.
    const inserted = captured.insertValues[0] as { senderId: string };
    expect(inserted.senderId).toBe('alice');
  });

  it('non-member is 403 (regression for Phase B\'s requireConversationMembership)', async () => {
    const { app } = await buildApp({
      user: BOB,
      behavior: {
        selects: [[{ id: 'conv-1', workspaceId: 'ws-1' }]], // resolver lookup → ws-1
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: 'hi' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin bypass works even without membership tuple', async () => {
    const { app, captured } = await buildApp({
      user: ROOT,
      behavior: {
        selects: [
          [{ id: 'conv-1', workspaceId: 'ws-1' }],
          [{ id: 'conv-1', workspaceId: 'ws-1' }],
          [],
        ],
        inserts: [[{ id: 'm-1', conversationId: 'conv-1', senderId: 'root', senderType: 'user', content: 'hi' }]],
        updates: [[]],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: 'hi' },
    });
    expect(res.statusCode).toBe(201);
    const inserted = captured.insertValues[0] as { senderId: string };
    expect(inserted.senderId).toBe('root');
  });
});

describe('Phase K — #95 admin-gate on cross-workspace list routes', () => {
  describe('GET /api/v1/workspaces', () => {
    it('non-admin member → 403', async () => {
      const { app } = await buildApp({ user: ALICE, tuples: MEMBER_OF_WS1 });
      const res = await app.inject({ method: 'GET', url: '/api/v1/workspaces' });
      expect(res.statusCode).toBe(403);
    });

    it('admin → 200', async () => {
      const { app } = await buildApp({ user: ROOT, behavior: { selects: [[]] } });
      const res = await app.inject({ method: 'GET', url: '/api/v1/workspaces' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/orgs', () => {
    it('non-admin member → 403', async () => {
      const { app } = await buildApp({ user: ALICE, tuples: MEMBER_OF_WS1 });
      const res = await app.inject({ method: 'GET', url: '/api/v1/orgs' });
      expect(res.statusCode).toBe(403);
    });

    it('admin → 200', async () => {
      const { app } = await buildApp({ user: ROOT, behavior: { selects: [[]] } });
      const res = await app.inject({ method: 'GET', url: '/api/v1/orgs' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/conversations', () => {
    it('non-admin member → 403', async () => {
      const { app } = await buildApp({ user: ALICE, tuples: MEMBER_OF_WS1 });
      const res = await app.inject({ method: 'GET', url: '/api/v1/conversations' });
      expect(res.statusCode).toBe(403);
    });

    it('admin → 200', async () => {
      const { app } = await buildApp({ user: ROOT, behavior: { selects: [[]] } });
      const res = await app.inject({ method: 'GET', url: '/api/v1/conversations' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/providers (admin OR ?workspaceId= with membership)', () => {
    it('no filter + non-admin → 403', async () => {
      const { app } = await buildApp({ user: ALICE, tuples: MEMBER_OF_WS1 });
      const res = await app.inject({ method: 'GET', url: '/api/v1/providers' });
      expect(res.statusCode).toBe(403);
    });

    it('no filter + admin → 200', async () => {
      const { app } = await buildApp({ user: ROOT, behavior: { selects: [[]] } });
      const res = await app.inject({ method: 'GET', url: '/api/v1/providers' });
      expect(res.statusCode).toBe(200);
    });

    it('?workspaceId= + member → 200', async () => {
      const { app } = await buildApp({
        user: ALICE,
        tuples: MEMBER_OF_WS1,
        behavior: { selects: [[]] },
      });
      const res = await app.inject({ method: 'GET', url: '/api/v1/providers?workspaceId=ws-1' });
      expect(res.statusCode).toBe(200);
    });

    it('?workspaceId= + non-member → 403', async () => {
      const { app } = await buildApp({ user: BOB });
      const res = await app.inject({ method: 'GET', url: '/api/v1/providers?workspaceId=ws-1' });
      expect(res.statusCode).toBe(403);
    });

    it('unauthenticated → 401', async () => {
      const { app } = await buildApp({ user: null });
      const res = await app.inject({ method: 'GET', url: '/api/v1/providers' });
      expect(res.statusCode).toBe(401);
    });
  });
});
