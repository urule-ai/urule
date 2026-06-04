import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ulid } from 'ulid';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/connection.js';
import { packages } from '../db/schema/packages.js';
import { entitlements } from '../db/schema/entitlements.js';
import {
  StripeSignatureError,
  verifyStripeSignature,
} from '../services/stripe-signature.js';

/*
 * Stripe webhook receiver. Maps `checkout.session.completed` →
 * `POST /api/v1/entitlements` (idempotent via the session id as
 * `externalRef`).
 *
 * The session must carry these metadata fields, set when the
 * publisher creates the Checkout Session:
 *   metadata.packageName         (required)
 *   metadata.workspaceId | userId (one of)
 *   metadata.kind                (purchase | subscription, default purchase)
 * Subscriptions also propagate `subscription.current_period_end` into
 * `entitlements.expires_at` so a lapsed sub flips off without manual
 * revocation.
 *
 * Signature is verified using `STRIPE_WEBHOOK_SECRET`. Missing or
 * mismatched → 400; never bypass even in dev because a permissive
 * webhook is a privilege escalation route.
 *
 * On a missing package or unknown event type we ALWAYS return 200 —
 * Stripe retries 4xx-and-up endlessly, and a misconfigured publisher
 * (typo'd packageName) is something the operator should diagnose
 * via logs, not via Stripe's dashboard going red.
 */

// #48 — the HMAC proves the body came from Stripe, but not that it has the
// shape we read. Zod-parse the consumed subset after signature verification so
// a malformed/partial payload is a clean 400 rather than a runtime throw deep
// in the handler. `mode` / `payment_status` are kept as loose strings (not
// enums) on purpose: an unrecognised value must fall through to the safe
// no-mint path, not 400 (which Stripe would retry forever). Unknown top-level
// Stripe fields are simply ignored.
const stripeEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    object: z.object({
      id: z.string().min(1),
      metadata: z.record(z.string(), z.string()).optional(),
      mode: z.string().optional(),
      // H-11 — `payment_status` is Stripe's authoritative settlement gate.
      // For card payments it's `'paid'` at completion; for delayed methods
      // (ACH, BNPL, …) it's `'unpaid'` at completion and flips to `'paid'`
      // when `checkout.session.async_payment_succeeded` fires. Free flows
      // (mode=setup, $0 sessions) report `'no_payment_required'`.
      payment_status: z.string().optional(),
      // checkout.session.completed → subscription period end is on
      // the subscription object, often nested. We accept either shape.
      subscription: z
        .union([
          z.string(),
          z.object({ id: z.string().optional(), current_period_end: z.number().optional() }),
          z.null(),
        ])
        .optional(),
    }),
  }),
});

type StripeEvent = z.infer<typeof stripeEventSchema>;

export function registerWebhookRoutes(app: FastifyInstance, db: Database): void {
  const secret = process.env['STRIPE_WEBHOOK_SECRET'];

  app.post('/api/v1/webhooks/stripe', {
    schema: {
      tags: ['webhooks'],
      summary: 'Stripe checkout webhook',
      description:
        'Inbound Stripe webhook receiver. Verifies the `Stripe-Signature` HMAC against `STRIPE_WEBHOOK_SECRET`, then on `checkout.session.completed` AND `checkout.session.async_payment_succeeded` mints an entitlement using the session id as `externalRef`. `kind` is derived from `session.mode` (NOT publisher metadata — H-11). Minting is gated on `payment_status === \'paid\' | \'no_payment_required\'`; delayed-payment flows mint only when the async-success companion event fires. Idempotent — retried deliveries return the existing row. Subscriptions propagate `subscription.current_period_end` into `expires_at`. Returns 200 on missing metadata / unknown package / unsupported event types / awaiting settlement so Stripe doesn\'t retry forever; 400 on signature mismatch; 503 if `STRIPE_WEBHOOK_SECRET` is unset.',
    },
  }, async (request, reply) => {
    if (!secret) {
      app.log.warn('STRIPE_WEBHOOK_SECRET not configured; rejecting webhook');
      return reply.code(503).send({
        error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Stripe webhook is not configured on this deployment' },
      });
    }

    const sigHeader = request.headers['stripe-signature'];
    if (!sigHeader || Array.isArray(sigHeader)) {
      return reply.code(400).send({
        error: { code: 'MISSING_SIGNATURE', message: 'Stripe-Signature header is required' },
      });
    }

    const raw = (request as FastifyRequest & { rawBody?: string }).rawBody;
    if (!raw) {
      app.log.error('Webhook request missing rawBody — content-type parser may be misconfigured');
      return reply.code(500).send({
        error: { code: 'NO_RAW_BODY', message: 'Server is unable to verify the signature' },
      });
    }

    try {
      verifyStripeSignature(raw, sigHeader, secret);
    } catch (err) {
      if (err instanceof StripeSignatureError) {
        return reply.code(400).send({
          error: { code: 'INVALID_SIGNATURE', message: err.message },
        });
      }
      throw err;
    }

    // #48 — validate the shape we consume (post-signature). Stripe sends far
    // more than this; unknown keys are stripped, not rejected.
    const parsed = stripeEventSchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, 'Stripe event failed shape validation');
      return reply.code(400).send({
        error: { code: 'MALFORMED_EVENT', message: 'Event body did not match the expected shape' },
      });
    }
    const event: StripeEvent = parsed.data;

    request.log.info({ stripeEventId: event.id, type: event.type }, 'Stripe webhook received');

    // H-11 — accept the deferred-payment companion event as well. Card flows
    // fire `completed` with `payment_status === 'paid'` once; ACH / BNPL fire
    // `completed` with `payment_status === 'unpaid'` first, then
    // `async_payment_succeeded` with `payment_status === 'paid'` when the
    // money lands. We mint only after the latter; the gate below enforces it.
    const MINT_EVENTS = new Set([
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
    ]);
    if (!MINT_EVENTS.has(event.type)) {
      // Ignore everything else for now — invoice.payment_failed etc.
      // are valid Stripe events but not yet wired to entitlement
      // revocation. Returning 200 keeps Stripe from retrying.
      return reply.code(200).send({ received: true, ignored: event.type });
    }

    const session = event.data.object;
    const meta = session.metadata ?? {};
    const packageName = meta['packageName'];
    const workspaceId = meta['workspaceId'];
    const userId = meta['userId'];
    // H-11 — `kind` was derived from publisher-controlled `meta.kind`. A
    // publisher could set `metadata.kind: 'subscription'` on a one-time
    // payment session and mint a never-expiring entitlement. Now derived
    // strictly from `session.mode`, Stripe's authoritative field. `mode ===
    // 'setup'` (saving a payment method) doesn't grant anything; fall
    // through to the no-mint path below.
    const kind: 'subscription' | 'purchase' | null =
      session.mode === 'subscription' ? 'subscription'
        : session.mode === 'payment' ? 'purchase'
          : null;

    if (!packageName || (!workspaceId && !userId)) {
      request.log.warn(
        { stripeEventId: event.id, meta },
        'Webhook session metadata missing packageName / consumer; ignoring',
      );
      return reply.code(200).send({ received: true, ignored: 'missing_metadata' });
    }

    if (kind === null) {
      // mode === 'setup' or absent — nothing to mint. Log loudly so a
      // misconfigured Checkout session is visible.
      request.log.warn(
        { stripeEventId: event.id, mode: session.mode },
        'Webhook session has no purchase mode; ignoring',
      );
      return reply.code(200).send({ received: true, ignored: 'unsupported_mode' });
    }

    // H-11 — Stripe's settlement gate. `checkout.session.completed` fires
    // BEFORE the money lands for delayed-payment methods; minting then
    // would grant access to a buyer who hasn't paid (and may never pay).
    // Accept `'paid'` (card flows + post-settlement async) and
    // `'no_payment_required'` (free flows; not currently a real path but
    // future-proof). Defer everything else until the async-success
    // companion event fires.
    const paymentStatus = session.payment_status;
    if (paymentStatus !== 'paid' && paymentStatus !== 'no_payment_required') {
      request.log.info(
        { stripeEventId: event.id, paymentStatus },
        'Webhook payment_status not settled; waiting for async_payment_succeeded',
      );
      return reply.code(200).send({
        received: true,
        ignored: 'awaiting_settlement',
        paymentStatus: paymentStatus ?? null,
      });
    }

    const [pkg] = await db.select().from(packages).where(eq(packages.name, packageName));
    if (!pkg) {
      request.log.warn(
        { stripeEventId: event.id, packageName },
        'Webhook references unknown package; ignoring',
      );
      return reply.code(200).send({ received: true, ignored: 'unknown_package' });
    }

    // Idempotency: same session id (externalRef) on the same package
    // short-circuits the insert. Stripe at-least-once-delivers; we
    // don't want duplicate entitlement rows from a retried webhook.
    const externalRef = session.id;
    const [existing] = await db
      .select()
      .from(entitlements)
      .where(and(eq(entitlements.packageId, pkg.id), eq(entitlements.externalRef, externalRef)));
    if (existing) {
      return reply.code(200).send({ received: true, entitlementId: existing.id, idempotent: true });
    }

    let expiresAt: Date | null = null;
    if (kind === 'subscription' && session.subscription && typeof session.subscription === 'object') {
      const periodEnd = session.subscription.current_period_end;
      if (typeof periodEnd === 'number') {
        // Stripe period_end is unix seconds.
        expiresAt = new Date(periodEnd * 1000);
      }
    }

    // #33 — back the SELECT-then-INSERT idempotency with the unique
    // (package_id, external_ref) constraint. If a concurrent delivery of the
    // same session won the race between our SELECT and INSERT, ON CONFLICT DO
    // NOTHING makes this a no-op (empty RETURNING) instead of a duplicate row
    // or a 500; we then read back the winner and answer idempotently.
    const [row] = await db
      .insert(entitlements)
      .values({
        id: ulid(),
        packageId: pkg.id,
        workspaceId: workspaceId ?? null,
        userId: userId ?? null,
        kind,
        externalRef,
        expiresAt,
      })
      .onConflictDoNothing({ target: [entitlements.packageId, entitlements.externalRef] })
      .returning();

    if (!row) {
      const [winner] = await db
        .select()
        .from(entitlements)
        .where(and(eq(entitlements.packageId, pkg.id), eq(entitlements.externalRef, externalRef)));
      request.log.info(
        { stripeEventId: event.id, entitlementId: winner?.id, packageId: pkg.id },
        'Entitlement insert hit the idempotency constraint; returning existing row',
      );
      return reply.code(200).send({ received: true, entitlementId: winner?.id, idempotent: true });
    }

    request.log.info(
      { stripeEventId: event.id, entitlementId: row.id, packageId: pkg.id },
      'Entitlement minted from Stripe webhook',
    );
    return reply.code(201).send({ received: true, entitlementId: row.id });
  });
}
