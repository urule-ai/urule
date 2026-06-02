import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { authMiddleware } from '@urule/auth-middleware';
import { registerWebhookRoutes } from '../src/routes/webhooks.routes.js';
import { buildStripeSignatureHeaderForTest, verifyStripeSignature, StripeSignatureError } from '../src/services/stripe-signature.js';

const SECRET = 'whsec_test_secret_at_least_32_chars_xx';

/* ------------------------------------------------------------------ *
 * Mock Drizzle DB. The route does at most three reads + one write:
 *   1. SELECT packages WHERE name = ?         (lookup)
 *   2. SELECT entitlements WHERE pkg+ref      (idempotency)
 *   3. INSERT entitlements ... RETURNING      (mint)
 * Dispatch by call order — first SELECT goes to packages, second goes
 * to entitlements (always; the route looks up both).
 * ------------------------------------------------------------------ */
interface Behavior {
  pkg?: unknown;
  existingEntitlement?: unknown;
  insertReturns?: unknown[];
  insertThrows?: Error;
  onInsert?: (values: unknown) => void;
}

function makeMockDb(behavior: Behavior = {}) {
  let selectCallCount = 0;
  return {
    select: vi.fn(() => {
      const callIdx = selectCallCount++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (callIdx === 0) {
              return Promise.resolve(behavior.pkg !== undefined ? [behavior.pkg] : []);
            }
            return Promise.resolve(behavior.existingEntitlement !== undefined ? [behavior.existingEntitlement] : []);
          }),
        })),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn((v: unknown) => {
        behavior.onInsert?.(v);
        return {
          returning: vi.fn(() => {
            if (behavior.insertThrows) return Promise.reject(behavior.insertThrows);
            return Promise.resolve(behavior.insertReturns ?? []);
          }),
        };
      }),
    })),
    delete: vi.fn(),
    update: vi.fn(),
  } as never;
}

async function buildApp(behavior: Behavior = {}) {
  const app = Fastify({ logger: false });
  // Mirror server.ts: capture rawBody so the route can verify HMAC.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error);
      }
    },
  );
  await app.register(authMiddleware, { skipAuth: true });
  registerWebhookRoutes(app, makeMockDb(behavior) as never);
  return app;
}

beforeEach(() => {
  process.env['STRIPE_WEBHOOK_SECRET'] = SECRET;
});

describe('stripe-signature helper', () => {
  it('round-trips a fresh signature', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
    const header = buildStripeSignatureHeaderForTest(body, SECRET);
    expect(() => verifyStripeSignature(body, header, SECRET)).not.toThrow();
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ id: 'evt_1' });
    const header = buildStripeSignatureHeaderForTest(body, SECRET);
    expect(() => verifyStripeSignature(body + ' ', header, SECRET)).toThrow(StripeSignatureError);
  });

  it('rejects when secret differs', () => {
    const body = JSON.stringify({ id: 'evt_1' });
    const header = buildStripeSignatureHeaderForTest(body, SECRET);
    expect(() => verifyStripeSignature(body, header, 'whsec_wrong_other_secret_padding_xx')).toThrow(
      StripeSignatureError,
    );
  });

  it('rejects when timestamp drifts past tolerance', () => {
    const body = JSON.stringify({ id: 'evt_1' });
    const oldTs = Math.floor(Date.now() / 1000) - 3600;
    const header = buildStripeSignatureHeaderForTest(body, SECRET, oldTs);
    expect(() => verifyStripeSignature(body, header, SECRET, { tolerance: 300 })).toThrow(
      StripeSignatureError,
    );
  });

  it('rejects header with no v1 signatures', () => {
    expect(() => verifyStripeSignature('payload', 't=1234', SECRET)).toThrow(StripeSignatureError);
  });
});

describe('webhooks route — signature gating', () => {
  it('returns 503 when STRIPE_WEBHOOK_SECRET is unset', async () => {
    delete process.env['STRIPE_WEBHOOK_SECRET'];
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      payload: { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } },
    });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error.code).toBe('WEBHOOK_NOT_CONFIGURED');
  });

  it('returns 400 when Stripe-Signature header is missing', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      payload: { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('MISSING_SIGNATURE');
  });

  it('returns 400 on a tampered body', async () => {
    const app = await buildApp({ pkg: { id: 'p1', name: 'foo' } });
    const original = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
    const header = buildStripeSignatureHeaderForTest(original, SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      headers: { 'stripe-signature': header, 'content-type': 'application/json' },
      payload: original + '   ',
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_SIGNATURE');
  });
});

describe('webhooks route — checkout.session.completed', () => {
  function signedPost(app: Awaited<ReturnType<typeof buildApp>>, payload: object) {
    const body = JSON.stringify(payload);
    const header = buildStripeSignatureHeaderForTest(body, SECRET);
    return app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      headers: { 'stripe-signature': header, 'content-type': 'application/json' },
      payload: body,
    });
  }

  it('mints an entitlement on a valid one-time payment session', async () => {
    const inserted = { id: '01ENT', packageId: 'p1', kind: 'purchase' };
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      insertReturns: [inserted],
    });
    const res = await signedPost(app, {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          mode: 'payment',
          payment_status: 'paid',
          metadata: { packageName: 'foo', workspaceId: 'ws-1' },
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.received).toBe(true);
    expect(body.entitlementId).toBe('01ENT');
  });

  it('mints a subscription with expires_at from current_period_end', async () => {
    const periodEnd = Math.floor(Date.now() / 1000) + 86400 * 30;
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      insertReturns: [{ id: '01ENT', packageId: 'p1', kind: 'subscription' }],
    });
    const res = await signedPost(app, {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          mode: 'subscription',
          payment_status: 'paid',
          metadata: { packageName: 'foo', userId: 'u-1' },
          subscription: { id: 'sub_1', current_period_end: periodEnd },
        },
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('idempotent on retry — second delivery returns the same entitlement', async () => {
    const existing = { id: '01EXISTING', packageId: 'p1', kind: 'purchase', externalRef: 'cs_1' };
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      existingEntitlement: existing,
    });
    const res = await signedPost(app, {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          mode: 'payment',
          payment_status: 'paid',
          metadata: { packageName: 'foo', workspaceId: 'ws-1' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.idempotent).toBe(true);
    expect(body.entitlementId).toBe('01EXISTING');
  });

  it('returns 200 ignored when metadata is missing — Stripe should not retry', async () => {
    const app = await buildApp({ pkg: { id: 'p1', name: 'foo' } });
    const res = await signedPost(app, {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', mode: 'payment', payment_status: 'paid', metadata: {} } },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ignored).toBe('missing_metadata');
  });

  it('returns 200 ignored when packageName is unknown', async () => {
    const app = await buildApp({ /* pkg undefined */ });
    const res = await signedPost(app, {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          mode: 'payment',
          payment_status: 'paid',
          metadata: { packageName: 'unknown', workspaceId: 'ws-1' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ignored).toBe('unknown_package');
  });

  it('ignores unsupported event types with 200', async () => {
    const app = await buildApp();
    const res = await signedPost(app, {
      id: 'evt_2',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1' } },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ignored).toBe('invoice.payment_failed');
  });

  /* ---------------------------------------------------------------- *
   * H-11 regressions — kind from session.mode (not publisher metadata),
   * payment_status gate, async-payment companion event.
   * ---------------------------------------------------------------- */

  it('H-11 — publisher metadata.kind=subscription on a payment-mode session is IGNORED (kind from session.mode)', async () => {
    let capturedKind: string | undefined;
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      insertReturns: [{ id: '01ENT', packageId: 'p1', kind: 'purchase' }],
      onInsert: (v) => {
        capturedKind = (v as { kind?: string }).kind;
      },
    });
    const res = await signedPost(app, {
      id: 'evt_x',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_x',
          mode: 'payment', // authoritative: one-time payment
          payment_status: 'paid',
          metadata: {
            packageName: 'foo',
            workspaceId: 'ws-1',
            kind: 'subscription', // attacker / misconfigured publisher
          },
          // No subscription object — confirms this isn't a real recurring purchase.
        },
      },
    });
    expect(res.statusCode).toBe(201);
    // Stored kind tracks session.mode, NOT metadata.kind.
    expect(capturedKind).toBe('purchase');
  });

  it('H-11 — checkout.session.completed with payment_status=unpaid waits for settlement (no mint)', async () => {
    const app = await buildApp({ pkg: { id: 'p1', name: 'foo' } });
    const res = await signedPost(app, {
      id: 'evt_async',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_async',
          mode: 'payment',
          payment_status: 'unpaid', // delayed payment method (ACH/BNPL)
          metadata: { packageName: 'foo', workspaceId: 'ws-1' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ignored).toBe('awaiting_settlement');
    expect(body.paymentStatus).toBe('unpaid');
  });

  it('H-11 — async_payment_succeeded with payment_status=paid mints the entitlement', async () => {
    const app = await buildApp({
      pkg: { id: 'p1', name: 'foo' },
      insertReturns: [{ id: '01ASYNC', packageId: 'p1', kind: 'purchase' }],
    });
    const res = await signedPost(app, {
      id: 'evt_async_2',
      type: 'checkout.session.async_payment_succeeded',
      data: {
        object: {
          id: 'cs_async',
          mode: 'payment',
          payment_status: 'paid',
          metadata: { packageName: 'foo', workspaceId: 'ws-1' },
        },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).entitlementId).toBe('01ASYNC');
  });

  it('H-11 — mode=setup (saving a payment method) does not mint an entitlement', async () => {
    const app = await buildApp({ pkg: { id: 'p1', name: 'foo' } });
    const res = await signedPost(app, {
      id: 'evt_setup',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_setup',
          mode: 'setup',
          payment_status: 'paid',
          metadata: { packageName: 'foo', workspaceId: 'ws-1' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ignored).toBe('unsupported_mode');
  });
});
