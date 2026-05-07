import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/connection.js';
import { runtimes } from '../db/schema/runtimes.js';

const createRuntimeSchema = z.object({
  workspaceId: z.string().min(1),
  provider: z.string().min(1),
  profile: z.string().min(1),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});

export function registerRuntimeRoutes(app: FastifyInstance, db: Database) {
  // List runtimes for a workspace
  app.get<{ Params: { wsId: string } }>('/api/v1/workspaces/:wsId/runtimes', {
    schema: {
      tags: ['runtimes'],
      summary: 'List runtimes registered to a workspace',
      description: 'Returns sandbox runtime registrations the workspace can dispatch agent runs to (Docker, Firecracker, etc.). Empty list when none registered — not 404.',
    },
  }, async (request) => {
    const { wsId } = request.params;
    return db.select().from(runtimes).where(eq(runtimes.workspaceId, wsId));
  });

  // Register runtime
  app.post<{
    Body: { workspaceId: string; provider: string; profile: string; capabilities?: Record<string, unknown> };
  }>('/api/v1/runtimes', {
    schema: {
      tags: ['runtimes'],
      summary: 'Register a sandbox runtime',
      description: 'Body `{ workspaceId, provider, profile, capabilities? }`. The runtime-broker picks from registered runtimes when allocating sandboxes for agent runs. New runtimes land in `status: available`.',
    },
  }, async (request, reply) => {
    const parsed = createRuntimeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { workspaceId, provider, profile, capabilities } = parsed.data;
    const id = ulid();
    const now = new Date();

    const [runtime] = await db.insert(runtimes).values({
      id,
      workspaceId,
      provider,
      profile,
      status: 'available',
      capabilities: capabilities ?? {},
      createdAt: now,
      updatedAt: now,
    }).returning();

    reply.status(201).send(runtime);
  });

  // Get runtime by ID
  app.get<{ Params: { runtimeId: string } }>('/api/v1/runtimes/:runtimeId', {
    schema: {
      tags: ['runtimes'],
      summary: 'Get runtime by id',
      description: 'Returns the runtime row including its current status + capabilities. 404 RUNTIME_NOT_FOUND when the id is unknown.',
    },
  }, async (request, reply) => {
    const { runtimeId } = request.params;
    const [runtime] = await db.select().from(runtimes).where(eq(runtimes.id, runtimeId));

    if (!runtime) {
      reply.status(404).send({ error: { code: 'RUNTIME_NOT_FOUND', message: `Runtime ${runtimeId} not found` } });
      return;
    }

    return runtime;
  });
}
