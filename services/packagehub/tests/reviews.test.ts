import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { authMiddleware } from '@urule/auth-middleware';
import { registerReviewRoutes } from '../src/routes/reviews.routes.js';

// Lightweight mock of the Drizzle client. Validation tests don't touch
// the DB; the routes that DO call it are exercised through behavior.agent
// (the package lookup) and behavior.insertReturns / behavior.deleteReturns.
type AnyChain = { [k: string]: () => AnyChain } & PromiseLike<unknown[]>;
function chain(rows: unknown[]): AnyChain {
  const fn = (): AnyChain => proxy;
  const proxy: AnyChain = new Proxy(fn as unknown as AnyChain, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
      }
      return fn;
    },
  });
  return proxy;
}

interface Behavior {
  pkg?: unknown;
  insertReturns?: unknown[];
  insertThrows?: Error;
  updateReturns?: unknown[];
  deleteReturns?: unknown[];
  /** Rows for the GET list query. */
  listRows?: unknown[];
  /** Aggregate response for the AVG/COUNT query. */
  agg?: { avg: number | null; count: number };
}

function makeMockDb(behavior: Behavior = {}) {
  let selectCallCount = 0;
  return {
    select: vi.fn((shape?: unknown) => {
      // The first .select() per request is the package lookup; the second
      // (if any) is either the list query or the aggregate. We dispatch
      // by call order — the routes always lookup pkg first.
      const callIdx = selectCallCount++;
      // If `shape` is passed (e.g., `select({ avg, count })`) it's the
      // aggregate query.
      const isAggregate = shape && typeof shape === 'object' && 'avg' in (shape as Record<string, unknown>);
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (callIdx === 0) {
              // Package lookup.
              return Promise.resolve(behavior.pkg !== undefined ? [behavior.pkg] : []);
            }
            if (isAggregate) {
              return Promise.resolve([behavior.agg ?? { avg: null, count: 0 }]);
            }
            // List query — drizzle chains .orderBy().limit().offset()
            // before resolving; return a chain for those.
            return chain(behavior.listRows ?? []);
          }),
        })),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => {
          if (behavior.insertThrows) return Promise.reject(behavior.insertThrows);
          return Promise.resolve(behavior.insertReturns ?? []);
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(behavior.updateReturns ?? [])),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(behavior.deleteReturns ?? [])),
      })),
    })),
  } as never;
}

async function buildApp(behavior: Behavior = {}) {
  const app = Fastify({ logger: false });
  await app.register(authMiddleware, { skipAuth: true });
  registerReviewRoutes(app, makeMockDb(behavior) as never);
  return app;
}

describe('package reviews — validation', () => {
  it('POST returns 400 when reviewerId is missing', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/reviews',
      payload: { rating: 5, title: 'Great' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST returns 400 when rating is out of 1..5', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/reviews',
      payload: { reviewerId: 'u1', rating: 6, title: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST returns 400 when title is empty', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/reviews',
      payload: { reviewerId: 'u1', rating: 4, title: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST returns 400 when title exceeds 200 chars', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/reviews',
      payload: { reviewerId: 'u1', rating: 4, title: 'x'.repeat(201) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH returns 400 when no fields are provided', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/packages/foo/reviews/01ABC',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('package reviews — 404 paths', () => {
  it('GET returns 404 for unknown package', async () => {
    const app = await buildApp({ /* pkg undefined */ });
    const res = await app.inject({ method: 'GET', url: '/api/v1/packages/missing/reviews' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('PACKAGE_NOT_FOUND');
  });

  it('POST returns 404 for unknown package', async () => {
    const app = await buildApp({ /* pkg undefined */ });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/missing/reviews',
      payload: { reviewerId: 'u1', rating: 5, title: 'Great' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH returns 404 when review row does not exist', async () => {
    const app = await buildApp({ pkg: { id: 'p1', name: 'foo' }, updateReturns: [] });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/packages/foo/reviews/01MISSING',
      payload: { rating: 3 },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('REVIEW_NOT_FOUND');
  });

  it('DELETE returns 404 when review does not exist', async () => {
    const app = await buildApp({ pkg: { id: 'p1', name: 'foo' }, deleteReturns: [] });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/packages/foo/reviews/01MISSING',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('package reviews — happy paths', () => {
  it('POST returns 201 with the inserted row', async () => {
    const inserted = {
      id: '01REV',
      packageId: 'p1',
      reviewerId: 'u1',
      rating: 5,
      title: 'Excellent',
      body: 'Saved my week',
      version: '0.2.0',
      createdAt: new Date('2026-05-04').toISOString(),
      updatedAt: new Date('2026-05-04').toISOString(),
    };
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      insertReturns: [inserted],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/reviews',
      payload: { reviewerId: 'u1', rating: 5, title: 'Excellent', body: 'Saved my week', version: '0.2.0' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({ id: '01REV', rating: 5 });
  });

  it('POST returns 409 on duplicate-reviewer constraint violation', async () => {
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      insertThrows: new Error('duplicate key value violates unique constraint "package_reviews_pkg_reviewer_unique"'),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/reviews',
      payload: { reviewerId: 'u1', rating: 4, title: 'Again' },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('REVIEW_EXISTS');
  });

  it('PATCH returns the updated row', async () => {
    const updated = {
      id: '01REV',
      packageId: 'p1',
      reviewerId: 'u1',
      rating: 3,
      title: 'Updated',
      body: '',
      version: null,
      createdAt: new Date('2026-05-04').toISOString(),
      updatedAt: new Date('2026-05-05').toISOString(),
    };
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      updateReturns: [updated],
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/packages/foo/reviews/01REV',
      payload: { rating: 3, title: 'Updated' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).rating).toBe(3);
  });

  it('DELETE returns 204 on success', async () => {
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      deleteReturns: [{ id: '01REV' }],
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/packages/foo/reviews/01REV',
    });
    expect(res.statusCode).toBe(204);
  });
});
