import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authMiddleware } from '@urule/auth-middleware';
import { registerReviewRoutes } from '../src/routes/reviews.routes.js';

// MOCK_USER.id from auth-middleware's skipAuth path. Hardcoding here keeps
// the test self-explanatory; if auth-middleware ever changes the dev id
// these tests will fail loudly at the impersonation check.
const DEV_USER_ID = 'dev-user-001';

// Lightweight mock of the Drizzle client. Validation tests don't touch
// the DB; the routes that DO call it dispatch by select-call-order.
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
  /** Existing review row returned by the PATCH/DELETE pre-fetch (callIdx 1). */
  existingReview?: unknown;
  /** Rows for the GET list query. */
  listRows?: unknown[];
  /** Aggregate response for the AVG/COUNT query. */
  agg?: { avg: number | null; count: number };
}

function makeMockDb(behavior: Behavior = {}) {
  let selectCallCount = 0;
  return {
    select: vi.fn((shape?: unknown) => {
      // The first .select() per request is the package lookup. The second
      // is either the list query (GET), the existing-review pre-fetch
      // (PATCH/DELETE), or the aggregate (GET). We dispatch by call order
      // and shape.
      const callIdx = selectCallCount++;
      const isAggregate = shape && typeof shape === 'object' && 'avg' in (shape as Record<string, unknown>);
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (callIdx === 0) {
              return Promise.resolve(behavior.pkg !== undefined ? [behavior.pkg] : []);
            }
            if (isAggregate) {
              return Promise.resolve([behavior.agg ?? { avg: null, count: 0 }]);
            }
            // PATCH/DELETE pre-fetch the existing row before update/delete.
            if (behavior.existingReview !== undefined) {
              return Promise.resolve([behavior.existingReview]);
            }
            // GET list — drizzle chains .orderBy().limit().offset() before
            // resolving; return a chain for those.
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
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
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
      payload: { reviewerId: DEV_USER_ID, rating: 6, title: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST returns 400 when title is empty', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/reviews',
      payload: { reviewerId: DEV_USER_ID, rating: 4, title: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST returns 400 when title exceeds 200 chars', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/reviews',
      payload: { reviewerId: DEV_USER_ID, rating: 4, title: 'x'.repeat(201) },
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

describe('package reviews — authorisation', () => {
  it('POST returns 403 when reviewerId does not match the authenticated user', async () => {
    const app = await buildApp({ pkg: { id: 'p1', name: 'foo' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/reviews',
      payload: { reviewerId: 'someone-else', rating: 5, title: 'Impersonation attempt' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('REVIEWER_MISMATCH');
  });

  it('PATCH returns 403 when the review belongs to another user', async () => {
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      existingReview: { id: '01REV', packageId: 'p1', reviewerId: 'someone-else', rating: 4, title: 'theirs' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/packages/foo/reviews/01REV',
      payload: { rating: 1 },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('NOT_REVIEW_OWNER');
  });

  it('DELETE returns 403 when the review belongs to another user', async () => {
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      existingReview: { id: '01REV', packageId: 'p1', reviewerId: 'someone-else', rating: 4, title: 'theirs' },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/packages/foo/reviews/01REV',
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('NOT_REVIEW_OWNER');
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
      payload: { reviewerId: DEV_USER_ID, rating: 5, title: 'Great' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH returns 404 when review row does not exist', async () => {
    const app = await buildApp({ pkg: { id: 'p1', name: 'foo' } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/packages/foo/reviews/01MISSING',
      payload: { rating: 3 },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('REVIEW_NOT_FOUND');
  });

  it('DELETE returns 404 when review does not exist', async () => {
    const app = await buildApp({ pkg: { id: 'p1', name: 'foo' } });
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
      reviewerId: DEV_USER_ID,
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
      payload: { reviewerId: DEV_USER_ID, rating: 5, title: 'Excellent', body: 'Saved my week', version: '0.2.0' },
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
      payload: { reviewerId: DEV_USER_ID, rating: 4, title: 'Again' },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('REVIEW_EXISTS');
  });

  it('PATCH returns the updated row when caller owns the review', async () => {
    const updated = {
      id: '01REV',
      packageId: 'p1',
      reviewerId: DEV_USER_ID,
      rating: 3,
      title: 'Updated',
      body: '',
      version: null,
      createdAt: new Date('2026-05-04').toISOString(),
      updatedAt: new Date('2026-05-05').toISOString(),
    };
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      existingReview: { id: '01REV', packageId: 'p1', reviewerId: DEV_USER_ID, rating: 5, title: 'Old' },
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

  it('DELETE returns 204 when caller owns the review', async () => {
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      existingReview: { id: '01REV', packageId: 'p1', reviewerId: DEV_USER_ID, rating: 5, title: 'mine' },
      deleteReturns: [{ id: '01REV' }],
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/packages/foo/reviews/01REV',
    });
    expect(res.statusCode).toBe(204);
  });
});
