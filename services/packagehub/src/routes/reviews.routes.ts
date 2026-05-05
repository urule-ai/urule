import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { and, eq, desc, sql } from 'drizzle-orm';
import type { UruleUser } from '@urule/auth-middleware';
import type { Database } from '../db/connection.js';
import { packages } from '../db/schema/packages.js';
import { packageReviews } from '../db/schema/reviews.js';

const ratingSchema = z.number().int().min(1).max(5);

const createReviewSchema = z.object({
  reviewerId: z.string().min(1),
  rating: ratingSchema,
  title: z.string().min(1).max(200),
  body: z.string().max(10_000).optional(),
  version: z.string().max(50).optional(),
});

const updateReviewSchema = z.object({
  rating: ratingSchema.optional(),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(10_000).optional(),
  version: z.string().max(50).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  reviewerId: z.string().optional(),
});

// auth-middleware decorates `request.uruleUser` at runtime but does not
// publish a Fastify module augmentation; mirror governance's inline-cast.
function getUser(request: FastifyRequest): UruleUser | null {
  return (request as FastifyRequest & { uruleUser: UruleUser | null }).uruleUser;
}

export function registerReviewRoutes(app: FastifyInstance, db: Database) {
  /**
   * GET /api/v1/packages/:name/reviews
   *   Listing newest-first. Optional reviewerId filter for "my reviews"
   *   views. Pagination via limit (≤100) + offset.
   */
  app.get<{
    Params: { name: string };
    Querystring: { limit?: string; offset?: string; reviewerId?: string };
  }>('/api/v1/packages/:name/reviews', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { name } = request.params;

    const [pkg] = await db.select().from(packages).where(eq(packages.name, name));
    if (!pkg) {
      return reply.code(404).send({
        error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
      });
    }

    const limit = Math.min(parsed.data.limit ?? 50, 100);
    const offset = parsed.data.offset ?? 0;
    const filters = [eq(packageReviews.packageId, pkg.id)];
    if (parsed.data.reviewerId) {
      filters.push(eq(packageReviews.reviewerId, parsed.data.reviewerId));
    }

    const rows = await db
      .select()
      .from(packageReviews)
      .where(and(...filters))
      .orderBy(desc(packageReviews.createdAt))
      .limit(limit)
      .offset(offset);

    const [agg] = await db
      .select({
        avg: sql<number | null>`AVG(${packageReviews.rating})::float`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(packageReviews)
      .where(eq(packageReviews.packageId, pkg.id));
    const avg = agg?.avg ?? null;
    const count = agg?.count ?? 0;

    return {
      reviews: rows,
      summary: {
        averageRating: avg !== null ? Math.round(avg * 100) / 100 : null,
        reviewCount: count,
      },
      pagination: { limit, offset },
    };
  });

  /**
   * POST /api/v1/packages/:name/reviews
   *   Submit a review. UNIQUE(package_id, reviewer_id) at the DB level
   *   blocks duplicate submissions — a 409 surfaces the conflict and
   *   tells the caller to PATCH instead. The reviewerId in the body
   *   must match the authenticated user (anti-impersonation); 401 if
   *   unauthenticated, 403 on mismatch.
   */
  app.post<{
    Params: { name: string };
    Body: z.infer<typeof createReviewSchema>;
  }>('/api/v1/packages/:name/reviews', async (request, reply) => {
    const parsed = createReviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const user = getUser(request);
    if (!user) {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    }
    if (parsed.data.reviewerId !== user.id) {
      return reply.code(403).send({
        error: { code: 'REVIEWER_MISMATCH', message: 'reviewerId must match the authenticated user' },
      });
    }
    const { name } = request.params;

    const [pkg] = await db.select().from(packages).where(eq(packages.name, name));
    if (!pkg) {
      return reply.code(404).send({
        error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
      });
    }

    const id = ulid();
    const now = new Date();
    try {
      const [row] = await db.insert(packageReviews).values({
        id,
        packageId: pkg.id,
        reviewerId: parsed.data.reviewerId,
        rating: parsed.data.rating,
        title: parsed.data.title,
        body: parsed.data.body ?? '',
        version: parsed.data.version ?? null,
        createdAt: now,
        updatedAt: now,
      }).returning();
      return reply.code(201).send(row);
    } catch (err) {
      // UNIQUE constraint violation — reviewer already has a review.
      const message = err instanceof Error ? err.message : 'Insert failed';
      if (/unique/i.test(message) || /duplicate/i.test(message)) {
        return reply.code(409).send({
          error: {
            code: 'REVIEW_EXISTS',
            message: `Reviewer "${parsed.data.reviewerId}" already reviewed "${name}". Use PATCH to update.`,
          },
        });
      }
      throw err;
    }
  });

  /**
   * PATCH /api/v1/packages/:name/reviews/:reviewId
   *   Edit your own review. The existing row is loaded first so the
   *   handler can verify the authenticated user owns it; mismatched
   *   ownership returns 403 (not 404) to differentiate "the review
   *   exists but isn't yours" from "no such review".
   */
  app.patch<{
    Params: { name: string; reviewId: string };
    Body: z.infer<typeof updateReviewSchema>;
  }>('/api/v1/packages/:name/reviews/:reviewId', async (request, reply) => {
    const parsed = updateReviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const user = getUser(request);
    if (!user) {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    }
    const { name, reviewId } = request.params;

    const [pkg] = await db.select().from(packages).where(eq(packages.name, name));
    if (!pkg) {
      return reply.code(404).send({
        error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
      });
    }

    const [existing] = await db
      .select()
      .from(packageReviews)
      .where(and(eq(packageReviews.id, reviewId), eq(packageReviews.packageId, pkg.id)));
    if (!existing) {
      return reply.code(404).send({
        error: { code: 'REVIEW_NOT_FOUND', message: `Review ${reviewId} not found for package "${name}"` },
      });
    }
    if (existing.reviewerId !== user.id) {
      return reply.code(403).send({
        error: { code: 'NOT_REVIEW_OWNER', message: 'You can only edit your own reviews' },
      });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.rating !== undefined) update.rating = parsed.data.rating;
    if (parsed.data.title !== undefined) update.title = parsed.data.title;
    if (parsed.data.body !== undefined) update.body = parsed.data.body;
    if (parsed.data.version !== undefined) update.version = parsed.data.version;

    const [row] = await db
      .update(packageReviews)
      .set(update)
      .where(and(eq(packageReviews.id, reviewId), eq(packageReviews.packageId, pkg.id)))
      .returning();
    if (!row) {
      return reply.code(404).send({
        error: { code: 'REVIEW_NOT_FOUND', message: `Review ${reviewId} not found for package "${name}"` },
      });
    }
    return row;
  });

  /**
   * DELETE /api/v1/packages/:name/reviews/:reviewId
   *   Removes a review. Same ownership check as PATCH — 403 if the
   *   row exists but the caller didn't write it.
   */
  app.delete<{ Params: { name: string; reviewId: string } }>(
    '/api/v1/packages/:name/reviews/:reviewId',
    async (request, reply) => {
      const user = getUser(request);
      if (!user) {
        return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      }
      const { name, reviewId } = request.params;
      const [pkg] = await db.select().from(packages).where(eq(packages.name, name));
      if (!pkg) {
        return reply.code(404).send({
          error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
        });
      }
      const [existing] = await db
        .select()
        .from(packageReviews)
        .where(and(eq(packageReviews.id, reviewId), eq(packageReviews.packageId, pkg.id)));
      if (!existing) {
        return reply.code(404).send({
          error: { code: 'REVIEW_NOT_FOUND', message: `Review ${reviewId} not found for package "${name}"` },
        });
      }
      if (existing.reviewerId !== user.id) {
        return reply.code(403).send({
          error: { code: 'NOT_REVIEW_OWNER', message: 'You can only delete your own reviews' },
        });
      }
      const result = await db
        .delete(packageReviews)
        .where(and(eq(packageReviews.id, reviewId), eq(packageReviews.packageId, pkg.id)))
        .returning({ id: packageReviews.id });
      if (result.length === 0) {
        return reply.code(404).send({
          error: { code: 'REVIEW_NOT_FOUND', message: `Review ${reviewId} not found for package "${name}"` },
        });
      }
      return reply.code(204).send();
    },
  );
}
