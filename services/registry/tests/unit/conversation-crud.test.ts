import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authMiddleware } from '@urule/auth-middleware';
import { registerConversationRoutes } from '../../src/routes/conversations.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';

/* ------------------------------------------------------------------ *
 * Index-based mock-DB dispatch. Each .select() increments a counter
 * and dispatches to a different result based on call order. The map
 * is per-test — see each `it()` for the call sequence the route runs.
 * ------------------------------------------------------------------ */
type SelectStep = unknown[] | { __orderable: true; rows: unknown[] };

function orderable(rows: unknown[]): SelectStep {
  return { __orderable: true, rows };
}

function isOrderable(s: SelectStep): s is { __orderable: true; rows: unknown[] } {
  return typeof s === 'object' && s !== null && '__orderable' in s;
}

function buildOrderableChain(rows: unknown[]) {
  // Supports `.where(...).orderBy(...).limit(...).offset(...)`
  // and direct awaits at any point.
  const obj: Record<string, unknown> = {};
  obj['orderBy'] = vi.fn(() => obj);
  obj['limit'] = vi.fn(() => obj);
  obj['offset'] = vi.fn(() => obj);
  obj['then'] = (cb: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(cb);
  return obj;
}

interface MockBehavior {
  selects?: SelectStep[];
  insertReturns?: unknown[][];
  updateReturns?: unknown[][];
  deleteReturns?: unknown[][];
}

function makeMockDb(behavior: MockBehavior = {}) {
  let selectIdx = 0;
  let insertIdx = 0;
  let updateIdx = 0;
  let deleteIdx = 0;

  return {
    select: vi.fn(() => {
      const idx = selectIdx++;
      const step = behavior.selects?.[idx];
      // Build a chainable that supports .from(...).where(...) and any
      // combo of .orderBy / .limit / .offset afterwards.
      const result = step !== undefined && isOrderable(step)
        ? buildOrderableChain(step.rows)
        : Promise.resolve(Array.isArray(step) ? step : []);

      // Resolve the configured rows for direct `.from(...).limit(...)` and
      // `.from(...).orderBy(...).limit().offset()` (no .where) paths.
      const directRows = step === undefined
        ? []
        : isOrderable(step) ? step.rows : step;
      const fromRet = {
        where: vi.fn(() => result),
        // For routes that omit .where (e.g. workspace fallback selects with .limit only)
        limit: vi.fn(() => Promise.resolve(directRows)),
        orderBy: vi.fn(() => result),
      };
      return {
        from: vi.fn(() => fromRet),
      };
    }),
    insert: vi.fn(() => {
      const idx = insertIdx++;
      const rows = behavior.insertReturns?.[idx] ?? [];
      return {
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(rows)),
          then: (cb: (v: unknown) => unknown) => Promise.resolve(undefined).then(cb),
        })),
      };
    }),
    update: vi.fn(() => {
      const idx = updateIdx++;
      const rows = behavior.updateReturns?.[idx] ?? [];
      return {
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve(rows)),
            then: (cb: (v: unknown) => unknown) => Promise.resolve(undefined).then(cb),
          })),
        })),
      };
    }),
    delete: vi.fn(() => {
      const idx = deleteIdx++;
      const rows = behavior.deleteReturns?.[idx] ?? [];
      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(rows)),
        })),
      };
    }),
  } as never;
}

async function buildApp(behavior: MockBehavior = {}) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(authMiddleware, { skipAuth: true });
  app.setErrorHandler(errorHandler);
  registerConversationRoutes(app, makeMockDb(behavior) as never);
  return app;
}

describe('POST /api/v1/conversations', () => {
  it('creates a conversation with two agentIds and returns snake_case body', async () => {
    const convRow = {
      id: 'c-new',
      workspaceId: 'ws-1',
      title: 'Hello',
      type: 'direct',
      parentConversationId: null,
      branchedFromMessageId: null,
      createdAt: new Date('2026-05-01'),
      updatedAt: new Date('2026-05-01'),
    };
    const app = await buildApp({
      // workspaceId is provided non-default, so no workspace fallback select.
      insertReturns: [[convRow], []],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      payload: {
        workspaceId: 'ws-1',
        title: 'Hello',
        agentIds: ['agent-1', 'agent-2'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('c-new');
    expect(body.workspace_id).toBe('ws-1');
    expect(body.title).toBe('Hello');
    expect(body.parent_conversation_id).toBeNull();
    expect(body.branched_from_message_id).toBeNull();
  });

  it('falls back to first workspace when workspaceId === "default"', async () => {
    const convRow = {
      id: 'c-fallback',
      workspaceId: 'ws-resolved',
      title: 'Fallback',
      type: 'direct',
      parentConversationId: null,
      branchedFromMessageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const app = await buildApp({
      // First select: workspace fallback returns one row with id 'ws-resolved'.
      selects: [[{ id: 'ws-resolved' }]],
      insertReturns: [[convRow]],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      payload: {
        workspaceId: 'default',
        title: 'Fallback',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.workspace_id).toBe('ws-resolved');
  });

  it('returns 400 when title is empty', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      payload: { workspaceId: 'ws-1', title: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/conversations/:id', () => {
  it('returns 404 CONVERSATION_NOT_FOUND for unknown id', async () => {
    const app = await buildApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/missing',
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('returns 200 with agents: [] when there are no agent links', async () => {
    const conv = {
      id: 'c1',
      workspaceId: 'ws-1',
      title: 'Solo',
      type: 'direct',
      parentConversationId: null,
      branchedFromMessageId: null,
      createdAt: new Date('2026-05-01'),
      updatedAt: new Date('2026-05-01'),
    };
    const app = await buildApp({
      // 0: parent conv lookup  1: conversation_agents link rows (empty)
      selects: [[conv], []],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/c1',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('c1');
    expect(body.workspace_id).toBe('ws-1');
    expect(body.agents).toEqual([]);
  });

  it('returns 200 with one agent summary when there is one linked agent', async () => {
    const conv = {
      id: 'c1',
      workspaceId: 'ws-1',
      title: 'With agent',
      type: 'direct',
      parentConversationId: null,
      branchedFromMessageId: null,
      createdAt: new Date('2026-05-01'),
      updatedAt: new Date('2026-05-01'),
    };
    const agent = {
      id: 'agent-1',
      name: 'Helper',
      config: { accentColor: '#ff00ff' },
    };
    const app = await buildApp({
      // 0: parent conv  1: agent links  2: per-link agent select
      selects: [[conv], [{ conversationId: 'c1', agentId: 'agent-1' }], [agent]],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/c1',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].id).toBe('agent-1');
    expect(body.agents[0].name).toBe('Helper');
    expect(body.agents[0].accent_color).toBe('#ff00ff');
  });
});

describe('GET /api/v1/conversations', () => {
  it('lists conversations with message_count: 0 and last_message: null when empty', async () => {
    const conv = {
      id: 'c1',
      workspaceId: 'ws-1',
      title: 'Empty conv',
      type: 'direct',
      parentConversationId: null,
      branchedFromMessageId: null,
      createdAt: new Date('2026-05-01'),
      updatedAt: new Date('2026-05-01'),
    };
    // The list endpoint does:
    //   0: SELECT conversations (orderable)
    //   per-row:
    //     1: SELECT conversation_agents WHERE convId
    //     2: SELECT count(*) FROM messages WHERE convId
    //     3: SELECT messages WHERE convId ORDER BY ... LIMIT 1
    const app = await buildApp({
      selects: [
        orderable([conv]),          // conversations list
        [],                         // agent links
        [{ count: 0 }],             // count
        orderable([]),              // last message: where().orderBy().limit()
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations?workspaceId=ws-1',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('c1');
    expect(body[0].workspace_id).toBe('ws-1');
    expect(body[0].agents).toEqual([]);
    expect(body[0].message_count).toBe(0);
    expect(body[0].last_message).toBeNull();
  });
});

describe('POST /api/v1/conversations/:id/messages', () => {
  it('returns 404 when the conversation does not exist', async () => {
    const app = await buildApp({ selects: [[]] });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/missing/messages',
      payload: { senderId: 'u1', content: 'hi', senderType: 'agent' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('inserts an agent-sourced message and returns 201 with snake_case body', async () => {
    const conv = {
      id: 'c1',
      workspaceId: 'ws-1',
      title: 't',
      type: 'direct',
      parentConversationId: null,
      branchedFromMessageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const inserted = {
      id: 'm-new',
      conversationId: 'c1',
      senderId: 'agent-1',
      senderType: 'agent',
      content: 'hello',
      contentType: 'text',
      status: 'delivered',
      tokenCount: 0,
      actionButtons: [],
      createdAt: new Date('2026-05-01T10:00'),
    };
    const app = await buildApp({
      // 0: conv lookup
      selects: [[conv]],
      insertReturns: [[inserted]],
      updateReturns: [[{ id: 'c1' }]],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/c1/messages',
      payload: { senderId: 'agent-1', content: 'hello', senderType: 'agent' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('m-new');
    expect(body.conversation_id).toBe('c1');
    expect(body.sender_id).toBe('agent-1');
    expect(body.sender_type).toBe('agent');
    expect(body.content).toBe('hello');
    expect(body.content_type).toBe('text');
    expect(body.action_buttons).toEqual([]);
  });
});

describe('GET /api/v1/conversations/:id/messages', () => {
  it('returns 200 with an empty array when conversation has no messages', async () => {
    const conv = {
      id: 'c1',
      workspaceId: 'ws-1',
      title: 't',
      type: 'direct',
      parentConversationId: null,
      branchedFromMessageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const app = await buildApp({
      // 0: conv lookup  1: messages select (orderable)
      selects: [[conv], orderable([])],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/c1/messages',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });
});
