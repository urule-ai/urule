import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { authMiddleware } from '@urule/auth-middleware';
import { registerConversationRoutes } from '../../src/routes/conversations.routes.js';

/* ------------------------------------------------------------------ *
 * Mock Drizzle db. The branch route does these reads/writes:
 *   1. SELECT conversations WHERE id (parent lookup)
 *   2. SELECT messages WHERE id (fromMessage lookup)
 *   3. INSERT conversations RETURNING (new branch row)
 *   4. SELECT messages WHERE conversationId ORDER BY createdAt
 *   5. INSERT messages (only if any)
 *   6. SELECT conversation_agents WHERE conversationId (only when no
 *      agentIds override)
 *   7. INSERT conversation_agents (only when there are participants)
 *
 * Behavior is dispatched by call order on `select`.
 * ------------------------------------------------------------------ */
interface Behavior {
  parent?: unknown;
  fromMessage?: unknown;
  parentMessages?: unknown[];
  inheritedAgents?: Array<{ agentId: string }>;
  insertConvReturns?: unknown[];
  /** Children for the GET /branches endpoint. */
  children?: unknown[];
}

function makeOrderableResult(rows: unknown[]) {
  // Drizzle chains `.from(...).where(...).orderBy(...).limit(...)` in
  // some places. For our routes we only need .where() to be awaitable
  // OR to chain into .orderBy().
  const out = {
    orderBy: vi.fn(() => ({
      then: (cb: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(cb),
      limit: vi.fn(() => Promise.resolve(rows)),
    })),
    then: (cb: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(cb),
  };
  return out;
}

function makeMockDb(behavior: Behavior = {}) {
  let selectIdx = 0;
  return {
    select: vi.fn(() => {
      const idx = selectIdx++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            switch (idx) {
              case 0:
                return Promise.resolve(behavior.parent !== undefined ? [behavior.parent] : []);
              case 1:
                return Promise.resolve(behavior.fromMessage !== undefined ? [behavior.fromMessage] : []);
              case 2:
                // SELECT messages WHERE conversationId ORDER BY createdAt
                return makeOrderableResult(behavior.parentMessages ?? []);
              case 3:
                return Promise.resolve(behavior.inheritedAgents ?? []);
              case 4:
                // GET /branches: SELECT conversations WHERE parent
                return makeOrderableResult(behavior.children ?? []);
              default:
                return Promise.resolve([]);
            }
          }),
        })),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(behavior.insertConvReturns ?? [])),
      })),
    })),
    update: vi.fn(),
    delete: vi.fn(),
  } as never;
}

async function buildApp(behavior: Behavior = {}) {
  const app = Fastify({ logger: false });
  await app.register(authMiddleware, { skipAuth: true });
  registerConversationRoutes(app, makeMockDb(behavior) as never);
  return app;
}

describe('POST /api/v1/conversations/:id/branch', () => {
  const PARENT = {
    id: 'c1',
    workspaceId: 'ws-1',
    title: 'Original',
    type: 'direct',
    parentConversationId: null,
    branchedFromMessageId: null,
    createdAt: new Date('2026-05-01'),
    updatedAt: new Date('2026-05-01'),
  };

  it('returns 400 when fromMessageId is missing', async () => {
    const app = await buildApp({ parent: PARENT });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/c1/branch',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when parent conversation does not exist', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/missing/branch',
      payload: { fromMessageId: 'm1' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('returns 404 when fromMessageId does not exist', async () => {
    const app = await buildApp({ parent: PARENT });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/c1/branch',
      payload: { fromMessageId: 'missing' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('MESSAGE_NOT_FOUND');
  });

  it('returns 400 when fromMessageId belongs to a different conversation', async () => {
    const app = await buildApp({
      parent: PARENT,
      fromMessage: { id: 'm-other', conversationId: 'c2' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/c1/branch',
      payload: { fromMessageId: 'm-other' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('MESSAGE_NOT_IN_CONVERSATION');
  });

  it('creates a new conversation linked to parent + branched_from_message_id', async () => {
    const branchRow = {
      id: 'c2',
      workspaceId: 'ws-1',
      title: 'Original (branch)',
      type: 'direct',
      parentConversationId: 'c1',
      branchedFromMessageId: 'm2',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const app = await buildApp({
      parent: PARENT,
      fromMessage: { id: 'm2', conversationId: 'c1' },
      parentMessages: [
        { id: 'm1', conversationId: 'c1', senderId: 'u1', senderType: 'user', content: 'hi', contentType: 'text', status: 'delivered', tokenCount: 1, actionButtons: [], createdAt: new Date('2026-05-01T10:00') },
        { id: 'm2', conversationId: 'c1', senderId: 'agent-1', senderType: 'agent', content: 'hello', contentType: 'text', status: 'delivered', tokenCount: 2, actionButtons: [], createdAt: new Date('2026-05-01T10:01') },
        { id: 'm3', conversationId: 'c1', senderId: 'u1', senderType: 'user', content: 'don\'t copy me', contentType: 'text', status: 'delivered', tokenCount: 1, actionButtons: [], createdAt: new Date('2026-05-01T10:02') },
      ],
      inheritedAgents: [{ agentId: 'agent-1' }],
      insertConvReturns: [branchRow],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/c1/branch',
      payload: { fromMessageId: 'm2' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('c2');
    expect(body.parent_conversation_id).toBe('c1');
    expect(body.branched_from_message_id).toBe('m2');
    expect(body.title).toBe('Original (branch)');
  });

  it('uses caller-provided title when set', async () => {
    const branchRow = {
      id: 'c2',
      workspaceId: 'ws-1',
      title: 'Custom branch',
      type: 'direct',
      parentConversationId: 'c1',
      branchedFromMessageId: 'm1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const app = await buildApp({
      parent: PARENT,
      fromMessage: { id: 'm1', conversationId: 'c1' },
      parentMessages: [],
      inheritedAgents: [],
      insertConvReturns: [branchRow],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/c1/branch',
      payload: { fromMessageId: 'm1', title: 'Custom branch' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).title).toBe('Custom branch');
  });
});

describe('GET /api/v1/conversations/:id/branches', () => {
  it('returns 404 when the parent does not exist', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/missing/branches',
    });
    expect(res.statusCode).toBe(404);
  });

  it('lists child conversations newest-first', async () => {
    const PARENT = { id: 'c1', workspaceId: 'ws-1', title: 'p', type: 'direct' };
    const children = [
      {
        id: 'c2',
        workspaceId: 'ws-1',
        title: 'p (branch)',
        type: 'direct',
        parentConversationId: 'c1',
        branchedFromMessageId: 'm2',
        createdAt: new Date('2026-05-02'),
        updatedAt: new Date('2026-05-02'),
      },
      {
        id: 'c3',
        workspaceId: 'ws-1',
        title: 'p (alt branch)',
        type: 'direct',
        parentConversationId: 'c1',
        branchedFromMessageId: 'm1',
        createdAt: new Date('2026-05-01'),
        updatedAt: new Date('2026-05-01'),
      },
    ];

    // The route does:
    //   1. SELECT conversations WHERE id (parent)
    //   2. SELECT conversations WHERE parent_conversation_id ORDER BY createdAt DESC
    // We pre-populate behavior.children for the second select; the
    // mock dispatches by index — parent at idx=0, children at idx=4.
    // Wire the parent at idx=0; the dispatcher already returns
    // behavior.children for idx=4 above, but our lookup for the
    // GET-branches request only does 2 selects total. Adjust the
    // mock dispatch to match.
    const app = await buildApp({ parent: PARENT, children });

    // The mock above maps idx===4 to children, but GET /branches only
    // does 2 selects (idx 0 + idx 1). Re-wire for this test using the
    // simpler shape: parent at idx 0, children at idx 1.
    const app2 = Fastify({ logger: false });
    await app2.register(authMiddleware, { skipAuth: true });
    let i = 0;
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            const idx = i++;
            if (idx === 0) return Promise.resolve([PARENT]);
            return {
              orderBy: vi.fn(() => Promise.resolve(children)),
            };
          }),
        })),
      })),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    registerConversationRoutes(app2, db as never);

    const res = await app2.inject({
      method: 'GET',
      url: '/api/v1/conversations/c1/branches',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('c2');
    expect(body[1].id).toBe('c3');
    void app; // silence unused
  });
});
