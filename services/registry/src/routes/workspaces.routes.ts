import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { parentTuple, workspaceTuple } from '@urule/authz';
import { AuditLogger } from '@urule/events';
import type { Database } from '../db/connection.js';
import { workspaces } from '../db/schema/workspaces.js';

const createWorkspaceSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().optional(),
  status: z.string().optional(),
}).strict();

const orgIdParamsSchema = z.object({ orgId: z.string() });
const wsIdParamsSchema = z.object({ wsId: z.string() });

/** Transform Drizzle workspace row to UI-expected snake_case. */
function toUiWorkspace(row: Record<string, unknown>) {
  return {
    id: row.id,
    organization_id: row.orgId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    is_default: true,
    human_in_the_loop: false,
    guardrails: {
      human_approval_required: true,
      auto_scale_compute: false,
      audit_log_persistence: true,
      dark_launch_protocol: false,
    },
    settings: {},
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function registerWorkspaceRoutes(app: FastifyInstance, db: Database) {
  const audit = new AuditLogger('registry', (topic, data) => {
    app.log.info({ audit: true, topic, ...(data as Record<string, unknown>) }, 'audit');
  });

  // List all workspaces
  app.get('/api/v1/workspaces', {
    schema: {
      tags: ['workspaces'],
      summary: 'List all workspaces',
      description: 'Returns every workspace in the system. Admin-shaped — most callers should use `/orgs/:orgId/workspaces` instead to scope to their tenant.',
    },
  }, async () => {
    const rows = await db.select().from(workspaces);
    return rows.map(row => toUiWorkspace(row as Record<string, unknown>));
  });

  // Get "current" workspace — returns the first workspace (demo mode)
  app.get('/api/v1/workspaces/current', {
    schema: {
      tags: ['workspaces'],
      summary: 'Get the current workspace',
      description: "Demo-mode shortcut: returns the first workspace in the database. When multi-workspace UX lands, this becomes session-scoped (the user's currently-selected workspace from their session/JWT). 404 NO_WORKSPACE when none exists.",
    },
  }, async (request, reply) => {
    const rows = await db.select().from(workspaces).limit(1);
    if (rows.length === 0) {
      reply.status(404).send({ error: { code: 'NO_WORKSPACE', message: 'No workspace configured' } });
      return;
    }
    return toUiWorkspace(rows[0] as Record<string, unknown>);
  });

  // Get workspace setup status (demo: always complete)
  app.get('/api/v1/workspaces/current/setup-status', {
    schema: {
      tags: ['workspaces'],
      summary: 'Workspace setup completion status',
      description: 'Returns `{ is_setup_complete, complete, steps }`. Office-ui hits this on /office to decide whether to redirect new users to /setup. Currently always-complete in demo mode.',
    },
  }, async () => {
    return { is_setup_complete: true, complete: true, steps: [] };
  });

  // Update current workspace (for settings page)
  app.patch<{ Body: z.infer<typeof updateWorkspaceSchema> }>('/api/v1/workspaces/current', {
    schema: {
      tags: ['workspaces'],
      summary: 'Update the current workspace',
      description: 'Partial update — name, description, etc. Used by the office-ui settings page. Targets the same workspace that `GET /current` would return.',
      body: updateWorkspaceSchema,
    },
  }, async (request, reply) => {
    const rows = await db.select().from(workspaces).limit(1);
    if (rows.length === 0) {
      reply.status(404).send({ error: { code: 'NO_WORKSPACE', message: 'No workspace configured' } });
      return;
    }
    const updates = request.body as Record<string, unknown>;
    const [updated] = await db.update(workspaces)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(workspaces.id, rows[0]!.id))
      .returning();
    return toUiWorkspace(updated as Record<string, unknown>);
  });

  // Update current workspace guardrails
  app.patch('/api/v1/workspaces/current/guardrails', {
    schema: {
      tags: ['workspaces'],
      summary: 'Update workspace guardrails (stub)',
      description: 'Demo-mode stub: acknowledges the update and returns `{ ok: true }` without persisting. The full guardrails wire-up routes through governance/OPA when that surface lands.',
    },
  }, async (request, reply) => {
    // In demo mode, just acknowledge the update
    reply.send({ ok: true });
  });

  // List workspaces for an org
  app.get<{ Params: z.infer<typeof orgIdParamsSchema> }>('/api/v1/orgs/:orgId/workspaces', {
    schema: {
      tags: ['workspaces'],
      summary: 'List workspaces in an org',
      description: 'Returns every workspace belonging to the given org. Empty array (200) when the org has no workspaces yet — not 404.',
      params: orgIdParamsSchema,
    },
  }, async (request) => {
    const { orgId } = request.params;
    const rows = await db.select().from(workspaces).where(eq(workspaces.orgId, orgId));
    return rows.map(row => toUiWorkspace(row as Record<string, unknown>));
  });

  // Create workspace
  app.post<{ Body: z.infer<typeof createWorkspaceSchema> }>(
    '/api/v1/workspaces',
    {
      schema: {
        tags: ['workspaces'],
        summary: 'Create a workspace',
        description: 'Body `{ orgId, name, slug, description? }`. Slug must be unique within the org. New workspaces land in `status: active`.',
        body: createWorkspaceSchema,
      },
    },
    async (request, reply) => {
      const { orgId, name, slug, description } = request.body;
      const user = (request as { uruleUser?: { id?: string; username?: string } }).uruleUser;
      const id = ulid();
      const now = new Date();

      const [workspace] = await db.insert(workspaces).values({
        id,
        orgId,
        name,
        slug,
        description: description ?? '',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }).returning();

      // Seed OpenFGA: the creator owns the workspace, and the workspace links to
      // its parent org so org members inherit `member` via the `parent` userset.
      // Non-fatal — registry availability must not depend on OpenFGA.
      try {
        const tuples = [parentTuple('workspace', id, 'org', orgId)];
        if (user?.id) tuples.push(workspaceTuple(user.id, 'owner', id));
        await request.authz.writeTuples(tuples);
      } catch (err) {
        request.log.warn({ err, workspaceId: id }, 'authz: failed to write workspace tuples');
      }

      audit.entityCreated(
        { id: user?.id ?? 'anonymous', username: user?.username ?? 'anonymous' },
        'workspace', id, `Workspace "${name}" created`,
        { workspaceId: id },
      ).catch((err: unknown) => request.log.warn({ err }, 'audit emit failed'));

      reply.status(201).send(toUiWorkspace(workspace as Record<string, unknown>));
    },
  );

  // Get workspace by ID
  app.get<{ Params: z.infer<typeof wsIdParamsSchema> }>('/api/v1/workspaces/:wsId', {
    schema: {
      tags: ['workspaces'],
      summary: 'Get workspace by id',
      description: '404 WORKSPACE_NOT_FOUND when the id is unknown.',
      params: wsIdParamsSchema,
    },
  }, async (request, reply) => {
    const { wsId } = request.params;
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));

    if (!workspace) {
      reply.status(404).send({ error: { code: 'WORKSPACE_NOT_FOUND', message: `Workspace ${wsId} not found` } });
      return;
    }

    return toUiWorkspace(workspace as Record<string, unknown>);
  });
}
