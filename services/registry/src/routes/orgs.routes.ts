import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/connection.js';
import { orgs } from '../db/schema/orgs.js';

const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
});

export function registerOrgRoutes(app: FastifyInstance, db: Database) {
  // List orgs
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/v1/orgs', {
    schema: {
      tags: ['orgs'],
      summary: 'List orgs',
      description: '`?limit` capped at 100; `?offset` for pagination. Returns every org in the system — typically only useful for admin tools since each user typically belongs to a single org.',
    },
  }, async (request) => {
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 100);
    const offset = parseInt(request.query.offset ?? '0', 10);
    return db.select().from(orgs).limit(limit).offset(offset);
  });

  // Create org
  app.post<{ Body: { name: string; slug: string } }>('/api/v1/orgs', {
    schema: {
      tags: ['orgs'],
      summary: 'Create an org',
      description: 'Body `{ name, slug }`. Slug must be unique across the system — if collision is a real risk in your deployment, prefix it with a tenant prefix at the caller. New orgs land in `status: active`.',
    },
  }, async (request, reply) => {
    const parsed = createOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { name, slug } = parsed.data;
    const id = ulid();
    const now = new Date();

    const [org] = await db.insert(orgs).values({
      id,
      name,
      slug,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).returning();

    reply.status(201).send(org);
  });

  // Get org by ID
  app.get<{ Params: { orgId: string } }>('/api/v1/orgs/:orgId', {
    schema: {
      tags: ['orgs'],
      summary: 'Get an org by id',
      description: '404 ORG_NOT_FOUND when the id is unknown.',
    },
  }, async (request, reply) => {
    const { orgId } = request.params;
    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));

    if (!org) {
      reply.status(404).send({ error: { code: 'ORG_NOT_FOUND', message: `Org ${orgId} not found` } });
      return;
    }

    return org;
  });
}
