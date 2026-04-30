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
  app.get<{ Params: { wsId: string } }>('/api/v1/workspaces/:wsId/runtimes', async (request) => {
    const { wsId } = request.params;
    return db.select().from(runtimes).where(eq(runtimes.workspaceId, wsId));
  });

  // Register runtime
  app.post<{
    Body: { workspaceId: string; provider: string; profile: string; capabilities?: Record<string, unknown> };
  }>('/api/v1/runtimes', async (request, reply) => {
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
  app.get<{ Params: { runtimeId: string } }>('/api/v1/runtimes/:runtimeId', async (request, reply) => {
    const { runtimeId } = request.params;
    const [runtime] = await db.select().from(runtimes).where(eq(runtimes.id, runtimeId));

    if (!runtime) {
      reply.status(404).send({ error: { code: 'RUNTIME_NOT_FOUND', message: `Runtime ${runtimeId} not found` } });
      return;
    }

    return runtime;
  });
}
