import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { registerPackageRoutes } from '../src/routes/packages.routes.js';
import { registerVersionRoutes } from '../src/routes/versions.routes.js';

/* ------------------------------------------------------------------ *
 * Phase E — publisher-ownership on packagehub. `POST /packages` records
 * the authenticated user as the package's `publisherId`; only that
 * account may `POST .../versions`. Closes the package/version-takeover
 * hole (#4). A custom onRequest hook stands in for @urule/auth-middleware.
 * ------------------------------------------------------------------ */

type TestUser = { id: string } | null;

interface MockDbOpts {
  selectRows?: unknown[][];
  insertRows?: unknown[][];
}

function makeMockDb(opts: MockDbOpts) {
  let s = 0;
  let i = 0;
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
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
    })),
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
  registerPackageRoutes(app, db);
  registerVersionRoutes(app, db);
  await app.ready();
  return { app, captured };
}

const ALICE = { id: 'alice' };
const BOB = { id: 'bob' };

describe('Phase E — packagehub publisher-ownership', () => {
  it('POST /packages — records the authenticated user as publisherId', async () => {
    const { app, captured } = await buildApp({
      user: ALICE,
      insertRows: [[{ id: 'p1', name: 'cool-pkg' }]],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages',
      payload: { name: 'cool-pkg', type: 'skill', author: 'Alice' },
    });
    expect(res.statusCode).toBe(201);
    expect((captured.insertValues[0] as { publisherId?: string }).publisherId).toBe('alice');
  });

  it('POST /packages — 401 when unauthenticated', async () => {
    const { app } = await buildApp({ user: null });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages',
      payload: { name: 'cool-pkg', type: 'skill', author: 'Alice' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /versions — 403 when the caller is not the package owner', async () => {
    const { app } = await buildApp({
      user: BOB,
      selectRows: [[{ id: 'p1', name: 'cool-pkg', publisherId: 'alice', publisherPubkey: null }]],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/cool-pkg/versions',
      payload: { version: '1.0.0', manifest: {} },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_PACKAGE_OWNER');
  });

  it('POST /versions — 201 for the package owner', async () => {
    const { app } = await buildApp({
      user: ALICE,
      selectRows: [[{ id: 'p1', name: 'cool-pkg', publisherId: 'alice', publisherPubkey: null }]],
      insertRows: [[{ id: 'v1', packageId: 'p1', version: '1.0.0' }]],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/cool-pkg/versions',
      payload: { version: '1.0.0', manifest: {} },
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST /versions — legacy package (no publisherId) still accepts publishes', async () => {
    // Pre-ownership / seed packages have a null publisherId — no owner check;
    // the signature gate (when a pubkey is set) remains the only guard.
    const { app } = await buildApp({
      user: BOB,
      selectRows: [[{ id: 'p1', name: 'legacy-pkg', publisherId: null, publisherPubkey: null }]],
      insertRows: [[{ id: 'v1', packageId: 'p1', version: '2.0.0' }]],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/legacy-pkg/versions',
      payload: { version: '2.0.0', manifest: {} },
    });
    expect(res.statusCode).toBe(201);
  });
});
