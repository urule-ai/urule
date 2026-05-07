import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ulid } from 'ulid';
import { and, eq } from 'drizzle-orm';
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

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      metadata?: Record<string, string>;
      mode?: 'payment' | 'subscription' | 'setup';
      // checkout.session.completed → subscription period end is on
      // the subscription object, often nested. We accept either shape.
      subscription?:
        | string
        | { id?: string; current_period_end?: number }
        | null;
    };
  };
}

export function registerWebhookRoutes(app: FastifyInstance, db: Database): void {
  const secret = process.env['STRIPE_WEBHOOK_SECRET'];

  app.post('/api/v1/webhooks/stripe', {
    schema: {
      tags: ['webhooks'],
      summary: 'Stripe checkout webhook',
      description:
        'Inbound Stripe webhook receiver. Verifies the `Stripe-Signature` HMAC against `STRIPE_WEBHOOK_SECRET`, then on `checkout.session.completed` mints an entitlement using the session id as `externalRef`. Idempotent — retried deliveries return the existing row. Subscriptions propagate `subscription.current_period_end` into `expires_at`. Returns 200 on missing metadata / unknown package / unsupported event types so Stripe doesn\'t retry forever; 400 on signature mismatch; 503 if `STRIPE_WEBHOOK_SECRET` is unset.',
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

    const event = request.body as StripeEvent;
    if (!event?.id || !event?.type) {
      return reply.code(400).send({
        error: { code: 'MALFORMED_EVENT', message: 'Event missing id/type' },
      });
    }

    request.log.info({ stripeEventId: event.id, type: event.type }, 'Stripe webhook received');

    if (event.type !== 'checkout.session.completed') {
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
    const kind = (meta['kind'] === 'subscription' ? 'subscription' : 'purchase') as 'subscription' | 'purchase';

    if (!packageName || (!workspaceId && !userId)) {
      request.log.warn(
        { stripeEventId: event.id, meta },
        'Webhook session metadata missing packageName / consumer; ignoring',
      );
      return reply.code(200).send({ received: true, ignored: 'missing_metadata' });
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
      .returning();

    request.log.info(
      { stripeEventId: event.id, entitlementId: row?.id, packageId: pkg.id },
      'Entitlement minted from Stripe webhook',
    );
    return reply.code(201).send({ received: true, entitlementId: row?.id });
  });
}
