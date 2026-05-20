import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { orgTuple } from '@urule/authz';
import { requireRole } from '@urule/authz-middleware';
import { AuditLogger } from '@urule/events';
import type { Database } from '../db/connection.js';
import { orgs } from '../db/schema/orgs.js';

const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
});

const orgIdParamsSchema = z.object({ orgId: z.string() });

const listOrgsQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
});

export function registerOrgRoutes(app: FastifyInstance, db: Database) {
  const audit = new AuditLogger('registry', (topic, data) => {
    app.log.info({ audit: true, topic, ...(data as Record<string, unknown>) }, 'audit');
  });

  // List orgs
  app.get<{ Querystring: z.infer<typeof listOrgsQuerySchema> }>('/api/v1/orgs', {
    schema: {
      tags: ['orgs'],
      summary: 'List orgs',
      description: '`?limit` capped at 100; `?offset` for pagination. Returns every org in the system — typically only useful for admin tools since each user typically belongs to a single org.',
      querystring: listOrgsQuerySchema,
    },
  }, async (request) => {
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 100);
    const offset = parseInt(request.query.offset ?? '0', 10);
    return db.select().from(orgs).limit(limit).offset(offset);
  });

  // Create org — admin-gated. Orgs are the top-level tenant boundary with no
  // parent resource to scope membership against, so creation requires the
  // `admin` realm role (conservative; relax to authenticated-only if org
  // self-signup is wanted — the creator is recorded as owner either way).
  app.post<{ Body: z.infer<typeof createOrgSchema> }>('/api/v1/orgs', {
    preHandler: requireRole('admin'),
    schema: {
      tags: ['orgs'],
      summary: 'Create an org',
      description: 'Body `{ name, slug }`. Slug must be unique across the system — if collision is a real risk in your deployment, prefix it with a tenant prefix at the caller. New orgs land in `status: active`. Admin-only.',
      body: createOrgSchema,
    },
  }, async (request, reply) => {
    const { name, slug } = request.body;
    const user = (request as { uruleUser?: { id?: string; username?: string } }).uruleUser;
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

    // Record the creator as the org's owner in OpenFGA. Owner ⊆ admin ⊆ member,
    // and workspace.member inherits org members via the `parent` userset — so
    // this single tuple seeds the whole authz tree for the new tenant.
    // Non-fatal: an orphaned org is admin-recoverable, and registry availability
    // must not depend on OpenFGA being reachable.
    if (user?.id) {
      try {
        await request.authz.writeTuples([orgTuple(user.id, 'owner', id)]);
      } catch (err) {
        request.log.warn({ err, orgId: id }, 'authz: failed to write org owner tuple');
      }
    }

    audit.entityCreated(
      { id: user?.id ?? 'anonymous', username: user?.username ?? 'anonymous' },
      'org', id, `Org "${name}" created`,
    ).catch((err: unknown) => request.log.warn({ err }, 'audit emit failed'));

    reply.status(201).send(org);
  });

  // Get org by ID
  app.get<{ Params: z.infer<typeof orgIdParamsSchema> }>('/api/v1/orgs/:orgId', {
    schema: {
      tags: ['orgs'],
      summary: 'Get an org by id',
      description: '404 ORG_NOT_FOUND when the id is unknown.',
      params: orgIdParamsSchema,
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
