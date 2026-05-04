import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { authMiddleware } from '@urule/auth-middleware';
import { registerAgentRoutes } from '../../src/routes/agents.routes.js';

// Minimal db stub. Validation-error tests don't reach the DB; the chain is
// only used inside the handler after schema parse succeeds.
type AnyChain = { [k: string]: () => AnyChain } & PromiseLike<unknown[]>;

function chainReturning(rows: unknown[]): AnyChain {
  const fn = (): AnyChain => proxy;
  const proxy: AnyChain = new Proxy(fn as unknown as AnyChain, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
      }
      return fn;
    },
  });
  return proxy;
}

function makeMockDb(behavior: { agent?: unknown; insertReturns?: unknown[]; deleteReturns?: unknown[] } = {}) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(behavior.agent !== undefined ? [behavior.agent] : [])),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(behavior.insertReturns ?? [])),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(behavior.deleteReturns ?? [])),
      })),
    })),
  } as never;
}

async function buildApp(db: ReturnType<typeof makeMockDb>) {
  const app = Fastify({ logger: false });
  await app.register(authMiddleware, { skipAuth: true });
  registerAgentRoutes(app, db as never);
  return app;
}

describe('agent endpoints — memory CRUD validation', () => {
  it('POST /memories returns 400 when content is missing', async () => {
    const app = await buildApp(makeMockDb());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/01ABC/memories',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Validation failed');
  });

  it('POST /memories returns 400 when content is empty string', async () => {
    const app = await buildApp(makeMockDb());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/01ABC/memories',
      payload: { content: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /memories returns 400 when content exceeds 10000 chars', async () => {
    const app = await buildApp(makeMockDb());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/01ABC/memories',
      payload: { content: 'x'.repeat(10001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /memories returns 400 when tags exceeds 20 entries', async () => {
    const app = await buildApp(makeMockDb());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/01ABC/memories',
      payload: { content: 'note', tags: Array.from({ length: 21 }, (_, i) => `tag${i}`) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /memories returns 404 when the agent does not exist', async () => {
    const app = await buildApp(makeMockDb({ /* agent: undefined */ }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/01MISSING/memories',
      payload: { content: 'note' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('AGENT_NOT_FOUND');
  });

  it('POST /memories returns 201 with the inserted row', async () => {
    const inserted = {
      id: '01MEM',
      agentId: '01ABC',
      content: 'remember this',
      kind: 'note',
      tags: [],
      createdAt: new Date('2026-01-01').toISOString(),
    };
    const app = await buildApp(makeMockDb({ agent: { id: '01ABC' }, insertReturns: [inserted] }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/01ABC/memories',
      payload: { content: 'remember this' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({ id: '01MEM', content: 'remember this' });
  });

  it('DELETE /memories/:id returns 404 when no row matches', async () => {
    const app = await buildApp(makeMockDb({ deleteReturns: [] }));
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/agents/01ABC/memories/01MISSING',
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('MEMORY_NOT_FOUND');
  });

  it('DELETE /memories/:id returns 204 on success', async () => {
    const app = await buildApp(makeMockDb({ deleteReturns: [{ id: '01MEM' }] }));
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/agents/01ABC/memories/01MEM',
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('agent endpoints — metrics + health 404', () => {
  it('GET /metrics returns 404 for missing agent', async () => {
    const app = await buildApp(makeMockDb({ /* agent: undefined */ }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/agents/01MISSING/metrics' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('AGENT_NOT_FOUND');
  });

  it('GET /health returns 404 for missing agent', async () => {
    const app = await buildApp(makeMockDb({ /* agent: undefined */ }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/agents/01MISSING/health' });
    expect(res.statusCode).toBe(404);
  });
});
