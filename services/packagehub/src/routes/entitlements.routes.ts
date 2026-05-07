import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { packages } from '../db/schema/packages.js';
import { entitlements } from '../db/schema/entitlements.js';

const checkQuerySchema = z.object({
  packageName: z.string().min(1),
  workspaceId: z.string().optional(),
  userId: z.string().optional(),
});

const grantSchema = z.object({
  packageName: z.string().min(1),
  workspaceId: z.string().optional(),
  userId: z.string().optional(),
  kind: z.enum(['purchase', 'subscription', 'grant']).optional(),
  externalRef: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
}).refine(
  (v) => !!v.workspaceId || !!v.userId,
  { message: 'workspaceId or userId required' },
);

export function registerEntitlementRoutes(app: FastifyInstance, db: Database) {
  /**
   * GET /api/v1/entitlements?packageName=...&workspaceId=...
   *   Authoritative gate consulted by the packages service before install.
   *   Free packages always allowed; paid/subscription require an
   *   entitlement row (purchase, subscription, or admin grant).
   */
  app.get<{
    Querystring: { packageName: string; workspaceId?: string; userId?: string };
  }>('/api/v1/entitlements', {
    schema: {
      tags: ['entitlements'],
      summary: 'Check entitlement (install gate)',
      description:
        'Authoritative gate consulted by the packages service before install. Returns `{ allowed: true, reason: "free" | "entitled" | "grant" }` for free packages and rows that pass; `{ allowed: false, reason: "requires_purchase", paymentLink }` otherwise. The packages service forwards `paymentLink` in its 402 ENTITLEMENT_REQUIRED error body so the UI can surface the checkout CTA without a second round-trip.',
    },
  }, async (request, reply) => {
    const parsed = checkQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { packageName, workspaceId, userId } = parsed.data;
    if (!workspaceId && !userId) {
      return reply.code(400).send({
        error: { code: 'CONSUMER_REQUIRED', message: 'workspaceId or userId required' },
      });
    }

    const [pkg] = await db.select().from(packages).where(eq(packages.name, packageName));
    if (!pkg) {
      return reply.code(404).send({
        error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${packageName}" not found` },
      });
    }

    // Free packages skip the lookup entirely.
    if (pkg.licenseTier === 'free') {
      return { allowed: true, reason: 'free' };
    }

    const now = new Date();
    const consumerFilters = [];
    if (workspaceId) consumerFilters.push(eq(entitlements.workspaceId, workspaceId));
    if (userId) consumerFilters.push(eq(entitlements.userId, userId));

    const rows = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.packageId, pkg.id),
          or(...consumerFilters)!,
          or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, now))!,
        ),
      );

    const row = rows[0];
    if (row) {
      return { allowed: true, reason: row.kind === 'grant' ? 'grant' : 'entitled', entitlementId: row.id };
    }

    return reply.code(200).send({
      allowed: false,
      reason: 'requires_purchase',
      licenseTier: pkg.licenseTier,
      priceCents: pkg.priceCents,
      paymentProvider: pkg.paymentProvider,
      paymentLink: pkg.paymentLink,
    });
  });

  /**
   * POST /api/v1/entitlements — mint an entitlement row.
   *   Used by future Stripe/Lemonsqueezy webhooks; today the manual
   *   "grant" path. Idempotent: if an active row already exists for the
   *   same (packageId, consumer, externalRef), return the existing one.
   */
  app.post<{
    Body: z.infer<typeof grantSchema>;
  }>('/api/v1/entitlements', {
    schema: {
      tags: ['entitlements'],
      summary: 'Mint an entitlement row',
      description:
        'Creates an entitlement record (`kind: purchase | subscription | grant`). The Stripe webhook receiver calls this on `checkout.session.completed`; admin tools call it for manual grants. Idempotent on the (packageId, externalRef) tuple — a retried call with the same external reference returns the existing row.',
    },
  }, async (request, reply) => {
    const parsed = grantSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { packageName, workspaceId, userId, kind, externalRef, expiresAt } = parsed.data;

    const [pkg] = await db.select().from(packages).where(eq(packages.name, packageName));
    if (!pkg) {
      return reply.code(404).send({
        error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${packageName}" not found` },
      });
    }

    // Idempotency: same externalRef on the same package short-circuits.
    if (externalRef) {
      const [existing] = await db
        .select()
        .from(entitlements)
        .where(
          and(
            eq(entitlements.packageId, pkg.id),
            eq(entitlements.externalRef, externalRef),
          ),
        );
      if (existing) return reply.code(200).send(existing);
    }

    const [row] = await db.insert(entitlements).values({
      id: ulid(),
      packageId: pkg.id,
      workspaceId: workspaceId ?? null,
      userId: userId ?? null,
      kind: kind ?? 'grant',
      externalRef: externalRef ?? null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    }).returning();
    return reply.code(201).send(row);
  });

  /**
   * DELETE /api/v1/entitlements/:id — revoke. Used for refunds.
   */
  app.delete<{ Params: { id: string } }>(
    '/api/v1/entitlements/:id',
    {
      schema: {
        tags: ['entitlements'],
        summary: 'Revoke an entitlement',
        description:
          'Hard-deletes the entitlement row. Used by the refund flow: a Stripe `charge.refunded` webhook (or admin tool) hits this endpoint with the entitlement id captured at mint time. 404 ENTITLEMENT_NOT_FOUND if already revoked.',
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const result = await db
        .delete(entitlements)
        .where(eq(entitlements.id, id))
        .returning({ id: entitlements.id });
      if (result.length === 0) {
        return reply.code(404).send({
          error: { code: 'ENTITLEMENT_NOT_FOUND', message: `Entitlement ${id} not found` },
        });
      }
      return reply.code(204).send();
    },
  );
}
