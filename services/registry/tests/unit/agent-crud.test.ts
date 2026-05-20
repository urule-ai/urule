import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authMiddleware } from '@urule/auth-middleware';
import { registerAgentRoutes } from '../../src/routes/agents.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';

/* ------------------------------------------------------------------ *
 * Index-based mock-DB. Each .select() / .insert() / .update() /
 * .delete() increments a counter and returns the configured result for
 * that index. For .select() the chain supports both
 * `.from(...).where(...).limit(...).offset(...)` and
 * `.from(...).limit(...)` (workspace fallback).
 * ------------------------------------------------------------------ */
function buildSelectChain(rows: unknown[]) {
  const obj: Record<string, unknown> = {};
  obj['where'] = vi.fn(() => obj);
  obj['orderBy'] = vi.fn(() => obj);
  obj['limit'] = vi.fn(() => obj);
  obj['offset'] = vi.fn(() => obj);
  obj['then'] = (cb: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(cb);
  return obj;
}

interface MockBehavior {
  selects?: unknown[][];
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
      const rows = behavior.selects?.[idx] ?? [];
      const chain = buildSelectChain(rows);
      return {
        from: vi.fn(() => chain),
      };
    }),
    insert: vi.fn(() => {
      const idx = insertIdx++;
      const rows = behavior.insertReturns?.[idx] ?? [];
      return {
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(rows)),
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
  registerAgentRoutes(app, makeMockDb(behavior) as never);
  return app;
}

describe('POST /api/v1/agents', () => {
  it('creates an agent and returns snake_case body with default accent_color + is_active', async () => {
    const inserted = {
      id: 'a1',
      workspaceId: 'ws-1',
      name: 'Helper',
      description: 'a desc',
      personalityPackId: null,
      status: 'idle',
      config: {},
      createdAt: new Date('2026-05-01'),
      updatedAt: new Date('2026-05-01'),
    };
    const app = await buildApp({
      // workspaceId provided non-default → no workspace fallback select.
      insertReturns: [[inserted]],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      payload: {
        workspaceId: 'ws-1',
        name: 'Helper',
        description: 'a desc',
        config: {},
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('a1');
    expect(body.workspace_id).toBe('ws-1');
    expect(body.name).toBe('Helper');
    expect(body.accent_color).toBe('#0db9f2');
    expect(body.is_active).toBe(true); // status idle → not offline
    expect(body.status).toBe('idle');
  });

  it('falls back to first workspace when workspaceId === "default"', async () => {
    const inserted = {
      id: 'a2',
      workspaceId: 'ws-resolved',
      name: 'Defaulted',
      description: '',
      personalityPackId: null,
      status: 'idle',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const app = await buildApp({
      // 0: workspace fallback select
      selects: [[{ id: 'ws-resolved' }]],
      insertReturns: [[inserted]],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      payload: { workspaceId: 'default', name: 'Defaulted' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).workspace_id).toBe('ws-resolved');
  });

  it('returns 400 when name is missing', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      payload: { workspaceId: 'ws-1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when name exceeds 100 chars', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      payload: { workspaceId: 'ws-1', name: 'x'.repeat(101) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/agents/:agentId', () => {
  it('returns 404 AGENT_NOT_FOUND for unknown id', async () => {
    const app = await buildApp({ selects: [[]] });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/missing',
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('AGENT_NOT_FOUND');
  });

  it('returns 200 with model_provider: null when config has no provider_id', async () => {
    const agent = {
      id: 'a1',
      workspaceId: 'ws-1',
      name: 'NoProvider',
      description: '',
      personalityPackId: null,
      status: 'idle',
      config: {},
      createdAt: new Date('2026-05-01'),
      updatedAt: new Date('2026-05-01'),
    };
    const app = await buildApp({ selects: [[agent]] });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/a1',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('a1');
    expect(body.model_provider).toBeNull();
  });

  it('returns 200 with model_provider populated when config.provider_id is set', async () => {
    const agent = {
      id: 'a1',
      workspaceId: 'ws-1',
      name: 'WithProvider',
      description: '',
      personalityPackId: null,
      status: 'idle',
      config: { provider_id: 'p1' },
      createdAt: new Date('2026-05-01'),
      updatedAt: new Date('2026-05-01'),
    };
    const provider = {
      id: 'p1',
      workspaceId: 'ws-1',
      name: 'Local Ollama',
      provider: 'ollama',
      modelName: 'llama3.1',
      baseUrl: 'http://localhost:11434',
      isDefault: true,
      isActive: true,
      createdAt: new Date('2026-04-01'),
    };
    const app = await buildApp({
      // 0: agent select  1: provider select
      selects: [[agent], [provider]],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/a1',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.model_provider).not.toBeNull();
    expect(body.model_provider.id).toBe('p1');
    expect(body.model_provider.provider).toBe('ollama');
    expect(body.model_provider.model_name).toBe('llama3.1');
  });
});

describe('PATCH /api/v1/agents/:agentId', () => {
  it('returns 200 with the updated agent name', async () => {
    const updated = {
      id: 'a1',
      workspaceId: 'ws-1',
      name: 'Renamed',
      description: '',
      personalityPackId: null,
      status: 'idle',
      config: {},
      createdAt: new Date('2026-05-01'),
      updatedAt: new Date('2026-05-02'),
    };
    const app = await buildApp({ updateReturns: [[updated]] });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/agents/a1',
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('a1');
    expect(body.name).toBe('Renamed');
  });

  it('returns 404 AGENT_NOT_FOUND when no row matches', async () => {
    const app = await buildApp({ updateReturns: [[]] });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/agents/missing',
      payload: { name: 'Whatever' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('AGENT_NOT_FOUND');
  });
});

describe('GET /api/v1/agents/:agentId/memories', () => {
  it('returns 200 with the configured memory rows', async () => {
    const memories = [
      {
        id: 'mem-2',
        agentId: 'a1',
        content: 'newer',
        kind: 'note',
        tags: [],
        createdAt: new Date('2026-05-02').toISOString(),
      },
      {
        id: 'mem-1',
        agentId: 'a1',
        content: 'older',
        kind: 'note',
        tags: [],
        createdAt: new Date('2026-05-01').toISOString(),
      },
    ];
    const app = await buildApp({ selects: [memories] });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/a1/memories?limit=10&offset=0',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('mem-2');
    expect(body[1].id).toBe('mem-1');
  });
});
