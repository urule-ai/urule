import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { generateKeyPairSync, sign } from 'node:crypto';
import { authMiddleware } from '@urule/auth-middleware';
import { registerPubkeysRoutes } from '../src/routes/pubkeys.routes.js';
import { rotationDigest } from '../src/services/signing.js';

/* ------------------------------------------------------------------ *
 * Helpers — generate raw 32-byte Ed25519 pubkeys + base64 + sign().
 * ------------------------------------------------------------------ */

function generateEd25519() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const raw = spki.subarray(spki.length - 32);
  return { rawPubB64: raw.toString('base64'), privateKey };
}

function signB64(privateKey: Parameters<typeof sign>[2], data: Buffer): string {
  return sign(null, data, privateKey).toString('base64');
}

/* ------------------------------------------------------------------ *
 * Mock DB. Routes do at most:
 *   1. SELECT packages WHERE name=...           (lookup)
 *   2. SELECT packagePubkeys WHERE packageId... (active list)
 *   3. SELECT packagePubkeys WHERE id+packageId (target row, PATCH only)
 *   4. SELECT packagePubkeys WHERE pubkey+pkg   (idempotency, POST only)
 *   5. INSERT/UPDATE packagePubkeys             (mint / revoke)
 *
 * Behaviour dispatches by call order.
 * ------------------------------------------------------------------ */

interface Behavior {
  pkg?: unknown;
  /** Rows returned by the active-keys query. */
  activeKeys?: Array<{ pubkey: string; pubkeyKind: string }>;
  /** Returned for PATCH target lookup. */
  targetRow?: unknown;
  /** Returned for the POST idempotency check. */
  duplicateRow?: unknown;
  /** Returned by INSERT ... RETURNING. */
  insertReturns?: unknown[];
  /** Returned by UPDATE ... RETURNING. */
  updateReturns?: unknown[];
  /** Override "list" for GET endpoint. */
  listRows?: unknown[];
}

function makeMockDb(behavior: Behavior = {}) {
  // Dispatch order is route-specific. PATCH order is:
  //   pkg  (idx 0)  → targetRow (idx 1) → activeKeys (idx 2)
  // POST-add order is:
  //   pkg  (idx 0)  → activeKeys (idx 1) → duplicate (idx 2)
  // GET-list is:
  //   pkg  (idx 0)  → listRows (idx 1)
  // We pick the dispatch shape by which fields are set on `behavior`.
  const isPatch = behavior.targetRow !== undefined;
  const isList = behavior.listRows !== undefined;
  let selectIdx = 0;
  return {
    select: vi.fn(() => {
      const idx = selectIdx++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (idx === 0) {
              return Promise.resolve(behavior.pkg !== undefined ? [behavior.pkg] : []);
            }
            if (isPatch) {
              if (idx === 1) return Promise.resolve([behavior.targetRow]);
              if (idx === 2) return Promise.resolve(behavior.activeKeys ?? []);
              return Promise.resolve([]);
            }
            if (isList) {
              if (idx === 1) return Promise.resolve(behavior.listRows ?? []);
              return Promise.resolve([]);
            }
            // POST-add path
            if (idx === 1) return Promise.resolve(behavior.activeKeys ?? []);
            if (idx === 2) {
              return Promise.resolve(behavior.duplicateRow !== undefined ? [behavior.duplicateRow] : []);
            }
            return Promise.resolve([]);
          }),
        })),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(behavior.insertReturns ?? [])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(behavior.updateReturns ?? [])),
        })),
      })),
    })),
    delete: vi.fn(),
  } as never;
}

async function buildApp(behavior: Behavior = {}) {
  const app = Fastify({ logger: false });
  await app.register(authMiddleware, { skipAuth: true });
  registerPubkeysRoutes(app, makeMockDb(behavior) as never);
  return app;
}

const PKG = { id: 'p1', name: 'foo', publisherPubkey: null, pubkeyKind: 'ed25519' };

/* ------------------------------------------------------------------ *
 * Tests.
 * ------------------------------------------------------------------ */

describe('rotationDigest', () => {
  it('binds operation, package name, and target pubkey', () => {
    const a = rotationDigest('add', 'foo', 'AAAA');
    const b = rotationDigest('revoke', 'foo', 'AAAA');
    const c = rotationDigest('add', 'bar', 'AAAA');
    const d = rotationDigest('add', 'foo', 'BBBB');
    expect(a.equals(b)).toBe(false);
    expect(a.equals(c)).toBe(false);
    expect(a.equals(d)).toBe(false);
  });
});

describe('GET /api/v1/packages/:name/pubkeys', () => {
  it('returns 404 when package does not exist', async () => {
    const app = await buildApp({});
    const res = await app.inject({ method: 'GET', url: '/api/v1/packages/nope/pubkeys' });
    expect(res.statusCode).toBe(404);
  });

  it('lists rotation rows for known package', async () => {
    const rows = [
      { id: '1', packageId: 'p1', pubkey: 'A', status: 'active' },
      { id: '2', packageId: 'p1', pubkey: 'B', status: 'revoked' },
    ];
    const app = await buildApp({ pkg: PKG, listRows: rows });
    const res = await app.inject({ method: 'GET', url: '/api/v1/packages/foo/pubkeys' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(2);
  });
});

describe('POST /api/v1/packages/:name/pubkeys — add (rotation)', () => {
  it('returns 401 when proof does not verify against any active key', async () => {
    const original = generateEd25519();
    const next = generateEd25519();
    // Wrong-key proof: sign with a key that's NOT in activeKeys.
    const stranger = generateEd25519();
    const digest = rotationDigest('add', 'foo', next.rawPubB64);
    const proof = signB64(stranger.privateKey, digest);

    const app = await buildApp({
      pkg: PKG,
      activeKeys: [{ pubkey: original.rawPubB64, pubkeyKind: 'ed25519' }],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/pubkeys',
      payload: { pubkey: next.rawPubB64, pubkeyKind: 'ed25519', proof },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('PROOF_INVALID');
  });

  it('mints a new active key when proof verifies against an existing one', async () => {
    const original = generateEd25519();
    const next = generateEd25519();
    const digest = rotationDigest('add', 'foo', next.rawPubB64);
    const proof = signB64(original.privateKey, digest);

    const inserted = { id: '01NEW', packageId: 'p1', pubkey: next.rawPubB64, status: 'active' };
    const app = await buildApp({
      pkg: PKG,
      activeKeys: [{ pubkey: original.rawPubB64, pubkeyKind: 'ed25519' }],
      duplicateRow: undefined, // no existing dup
      insertReturns: [inserted],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/pubkeys',
      payload: { pubkey: next.rawPubB64, pubkeyKind: 'ed25519', proof },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).id).toBe('01NEW');
  });

  it('returns 400 when the package has no active keys at all (anonymous)', async () => {
    const next = generateEd25519();
    // Even a valid-shape proof cannot verify against an empty key set.
    const proof = signB64(next.privateKey, rotationDigest('add', 'foo', next.rawPubB64));

    const app = await buildApp({ pkg: PKG, activeKeys: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/foo/pubkeys',
      payload: { pubkey: next.rawPubB64, pubkeyKind: 'ed25519', proof },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('PACKAGE_UNSIGNED');
  });
});

describe('PATCH /api/v1/packages/:name/pubkeys/:id — revoke', () => {
  it('refuses to revoke the last active key', async () => {
    const k = generateEd25519();
    const target = { id: 'k1', packageId: 'p1', pubkey: k.rawPubB64, status: 'active' };
    const proof = signB64(k.privateKey, rotationDigest('revoke', 'foo', k.rawPubB64));

    const app = await buildApp({
      pkg: PKG,
      targetRow: target,
      activeKeys: [{ pubkey: k.rawPubB64, pubkeyKind: 'ed25519' }],
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/packages/foo/pubkeys/k1',
      payload: { proof },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('LAST_ACTIVE_KEY');
  });

  it('revokes a key when another active one remains and proof verifies', async () => {
    const a = generateEd25519();
    const b = generateEd25519();
    const target = { id: 'k1', packageId: 'p1', pubkey: a.rawPubB64, status: 'active' };
    // Sign the revoke proof with the OTHER active key.
    const proof = signB64(b.privateKey, rotationDigest('revoke', 'foo', a.rawPubB64));

    const updated = { id: 'k1', packageId: 'p1', pubkey: a.rawPubB64, status: 'revoked' };
    const app = await buildApp({
      pkg: PKG,
      targetRow: target,
      activeKeys: [
        { pubkey: a.rawPubB64, pubkeyKind: 'ed25519' },
        { pubkey: b.rawPubB64, pubkeyKind: 'ed25519' },
      ],
      updateReturns: [updated],
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/packages/foo/pubkeys/k1',
      payload: { proof },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('revoked');
  });

  it('returns 409 when target is already revoked', async () => {
    const k = generateEd25519();
    const target = { id: 'k1', packageId: 'p1', pubkey: k.rawPubB64, status: 'revoked' };
    const proof = signB64(k.privateKey, rotationDigest('revoke', 'foo', k.rawPubB64));

    const app = await buildApp({ pkg: PKG, targetRow: target });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/packages/foo/pubkeys/k1',
      payload: { proof },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('ALREADY_REVOKED');
  });
});
