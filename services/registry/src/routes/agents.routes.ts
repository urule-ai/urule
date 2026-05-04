import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/connection.js';
import { agents } from '../db/schema/agents.js';
import { agentMemories } from '../db/schema/agent_memories.js';
import { conversationAgents, messages } from '../db/schema/conversations.js';
import { providers } from '../db/schema/providers.js';
import { workspaces } from '../db/schema/workspaces.js';
import { AuditLogger } from '@urule/events';

// Simple audit logger that logs to stdout (NATS integration can be added later)
const audit = new AuditLogger('registry', (topic, data) => {
  console.log(JSON.stringify({ audit: true, topic, ...data as Record<string, unknown> }));
});

const createAgentSchema = z.object({
  workspaceId: z.string().optional(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const agentStatusSchema = z.object({
  status: z.enum(['active', 'idle', 'offline', 'error', 'paused']),
});

const memoryCreateSchema = z.object({
  content: z.string().min(1).max(10000),
  kind: z.string().max(50).optional(),
  tags: z.array(z.string()).max(20).optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  status: z.string().optional(),
  workspaceId: z.string().optional(),
  personalityPackId: z.string().optional(),
  skillPacks: z.array(z.unknown()).optional(),
  mcpBindings: z.array(z.unknown()).optional(),
}).strict();

/** Transform a Drizzle agent row into the shape the UI expects (snake_case + derived fields). */
function toUiAgent(row: Record<string, unknown>, provider?: Record<string, unknown> | null) {
  const config = (row.config ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    description: row.description,
    role: config.role ?? '',
    category: config.category ?? '',
    system_prompt: config.systemPrompt ?? '',
    avatar_url: config.avatarUrl ?? '',
    accent_color: config.accentColor ?? '#0db9f2',
    package_id: row.personalityPackId ?? null,
    package_version: null,
    status: row.status,
    is_active: row.status !== 'offline',
    office_position: null,
    tool_permissions: config.toolPermissions ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    config,
    model_provider: provider ? {
      id: provider.id,
      workspace_id: provider.workspaceId,
      name: provider.name,
      provider: provider.provider,
      model_name: provider.modelName,
      base_url: provider.baseUrl,
      is_default: provider.isDefault,
      is_active: provider.isActive,
      created_at: provider.createdAt,
    } : null,
  };
}

export function registerAgentRoutes(app: FastifyInstance, db: Database) {
  // List all agents (across all workspaces)
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/v1/agents', async (request) => {
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 100);
    const offset = parseInt(request.query.offset ?? '0', 10);
    const rows = await db.select().from(agents).limit(limit).offset(offset);
    return Promise.all(rows.map(async (row) => {
      const config = (row.config ?? {}) as Record<string, unknown>;
      const providerId = config.provider_id as string | undefined;
      let provider = null;
      if (providerId) {
        const [p] = await db.select().from(providers).where(eq(providers.id, providerId));
        provider = p ?? null;
      }
      return toUiAgent(row as Record<string, unknown>, provider);
    }));
  });

  // List agents for a workspace
  app.get<{ Params: { wsId: string }; Querystring: { limit?: string; offset?: string } }>('/api/v1/workspaces/:wsId/agents', async (request) => {
    const { wsId } = request.params;
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 100);
    const offset = parseInt(request.query.offset ?? '0', 10);
    const rows = await db.select().from(agents).where(eq(agents.workspaceId, wsId)).limit(limit).offset(offset);
    return rows.map(row => toUiAgent(row as Record<string, unknown>));
  });

  // Register agent
  app.post<{
    Body: { workspaceId?: string; name: string; description?: string; config?: Record<string, unknown> };
  }>('/api/v1/agents', async (request, reply) => {
    const parsed = createAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    let { workspaceId } = parsed.data;
    const { name, description, config } = parsed.data;
    // Resolve workspace if not provided
    if (!workspaceId || workspaceId === 'default') {
      const [ws] = await db.select().from(workspaces).limit(1);
      workspaceId = ws?.id ?? 'default';
    }
    const id = ulid();
    const now = new Date();

    const [agent] = await db.insert(agents).values({
      id,
      workspaceId,
      name,
      description: description ?? '',
      skillPacks: [],
      mcpBindings: [],
      status: 'idle',
      config: config ?? {},
      createdAt: now,
      updatedAt: now,
    }).returning();

    const user = (request as any).uruleUser;
    audit.entityCreated(
      { id: user?.id ?? 'anonymous', username: user?.username ?? 'anonymous' },
      'agent', id, `Agent "${name}" created`,
      { workspaceId },
    ).catch(() => {});

    reply.status(201).send(toUiAgent(agent as Record<string, unknown>));
  });

  // Get agent by ID
  app.get<{ Params: { agentId: string } }>('/api/v1/agents/:agentId', async (request, reply) => {
    const { agentId } = request.params;
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));

    if (!agent) {
      reply.status(404).send({ error: { code: 'AGENT_NOT_FOUND', message: `Agent ${agentId} not found` } });
      return;
    }

    const config = (agent.config ?? {}) as Record<string, unknown>;
    const providerId = config.provider_id as string | undefined;
    let provider = null;
    if (providerId) {
      const [p] = await db.select().from(providers).where(eq(providers.id, providerId));
      provider = p ?? null;
    }

    return toUiAgent(agent as Record<string, unknown>, provider);
  });

  // Agent metrics — derived from messages + conversation_agents on read.
  app.get<{ Params: { agentId: string } }>('/api/v1/agents/:agentId/metrics', async (request, reply) => {
    const { agentId } = request.params;
    const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      return reply.code(404).send({ error: { code: 'AGENT_NOT_FOUND', message: `Agent ${agentId} not found` } });
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const agentMessages = and(eq(messages.senderId, agentId), eq(messages.senderType, 'agent'));

    const [totals] = await db
      .select({
        messagesSent: sql<number>`count(*)::int`,
        lastActive: sql<Date | null>`max(${messages.createdAt})`,
      })
      .from(messages)
      .where(agentMessages);

    const [recent] = await db
      .select({ messagesSent24h: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(agentMessages, gte(messages.createdAt, since24h)));

    const [conversationsRow] = await db
      .select({ conversationsParticipated: sql<number>`count(*)::int` })
      .from(conversationAgents)
      .where(eq(conversationAgents.agentId, agentId));

    return {
      messages_sent: totals?.messagesSent ?? 0,
      messages_sent_24h: recent?.messagesSent24h ?? 0,
      conversations_participated: conversationsRow?.conversationsParticipated ?? 0,
      last_active: totals?.lastActive ? totals.lastActive.toISOString() : null,
      // memory/CPU don't apply to logical agents — kept for FE compat.
      memory_usage_mb: 0,
      cpu_pct: 0,
    };
  });

  // Agent health — derived from last activity timestamp on messages.
  app.get<{ Params: { agentId: string } }>('/api/v1/agents/:agentId/health', async (request, reply) => {
    const { agentId } = request.params;
    const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      return reply.code(404).send({ error: { code: 'AGENT_NOT_FOUND', message: `Agent ${agentId} not found` } });
    }

    const [row] = await db
      .select({ lastActive: sql<Date | null>`max(${messages.createdAt})` })
      .from(messages)
      .where(and(eq(messages.senderId, agentId), eq(messages.senderType, 'agent')));

    const lastActive = row?.lastActive ?? null;
    const ageMs = lastActive ? Date.now() - lastActive.getTime() : Infinity;
    const status = !lastActive ? 'never_active'
      : ageMs < 5 * 60 * 1000 ? 'healthy'
      : ageMs < 30 * 60 * 1000 ? 'idle'
      : 'stale';

    return {
      status,
      last_heartbeat: lastActive ? lastActive.toISOString() : null,
      // memory/CPU don't apply to logical agents — kept for FE compat.
      memory_usage_mb: 0,
      cpu_pct: 0,
    };
  });

  // Agent conversations stub
  app.get<{ Params: { agentId: string } }>('/api/v1/agents/:agentId/conversations', async () => []);

  // Agent logs stub
  app.get<{ Params: { agentId: string } }>('/api/v1/agents/:agentId/logs', async () => []);

  // Agent memories — Drizzle-backed CRUD against the agent_memories table.
  app.get<{ Params: { agentId: string }; Querystring: { limit?: string; offset?: string } }>(
    '/api/v1/agents/:agentId/memories',
    async (request) => {
      const { agentId } = request.params;
      const q = request.query;
      const limit = Math.min(parseInt(q.limit ?? '50', 10), 100);
      const offset = parseInt(q.offset ?? '0', 10);
      return db
        .select()
        .from(agentMemories)
        .where(eq(agentMemories.agentId, agentId))
        .orderBy(desc(agentMemories.createdAt))
        .limit(limit)
        .offset(offset);
    },
  );

  app.post<{ Params: { agentId: string }; Body: { content: string; kind?: string; tags?: string[] } }>(
    '/api/v1/agents/:agentId/memories',
    async (request, reply) => {
      const parsed = memoryCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      const { agentId } = request.params;
      const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
      if (!agent) {
        return reply.code(404).send({ error: { code: 'AGENT_NOT_FOUND', message: `Agent ${agentId} not found` } });
      }
      const [memory] = await db.insert(agentMemories).values({
        id: ulid(),
        agentId,
        content: parsed.data.content,
        kind: parsed.data.kind ?? 'note',
        tags: parsed.data.tags ?? [],
      }).returning();
      return reply.code(201).send(memory);
    },
  );

  app.delete<{ Params: { agentId: string; memoryId: string } }>(
    '/api/v1/agents/:agentId/memories/:memoryId',
    async (request, reply) => {
      const { agentId, memoryId } = request.params;
      const result = await db
        .delete(agentMemories)
        .where(and(eq(agentMemories.id, memoryId), eq(agentMemories.agentId, agentId)))
        .returning({ id: agentMemories.id });
      if (result.length === 0) {
        return reply.code(404).send({ error: { code: 'MEMORY_NOT_FOUND', message: `Memory ${memoryId} not found` } });
      }
      reply.status(204).send();
    },
  );

  // Agent status update
  app.post<{ Params: { agentId: string }; Body: { status: string } }>(
    '/api/v1/agents/:agentId/status',
    async (request, reply) => {
      const parsed = agentStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      const { agentId } = request.params;
      const { status } = parsed.data;
      const [agent] = await db
        .update(agents)
        .set({ status, updatedAt: new Date() })
        .where(eq(agents.id, agentId))
        .returning();
      if (!agent) {
        reply.status(404).send({ error: { code: 'AGENT_NOT_FOUND', message: `Agent ${agentId} not found` } });
        return;
      }

      const user = (request as any).uruleUser;
      audit.entityUpdated(
        { id: user?.id ?? 'anonymous', username: user?.username ?? 'anonymous' },
        'agent', agentId, `Agent status changed to "${status}"`,
        { changes: { status: { after: status } } },
      ).catch(() => {});

      return toUiAgent(agent as Record<string, unknown>);
    },
  );

  // Update agent
  app.patch<{ Params: { agentId: string }; Body: Record<string, unknown> }>(
    '/api/v1/agents/:agentId',
    async (request, reply) => {
      const parsed = updateAgentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      const { agentId } = request.params;
      const updates = parsed.data;

      const [agent] = await db
        .update(agents)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(agents.id, agentId))
        .returning();

      if (!agent) {
        reply.status(404).send({ error: { code: 'AGENT_NOT_FOUND', message: `Agent ${agentId} not found` } });
        return;
      }

      const user = (request as any).uruleUser;
      audit.entityUpdated(
        { id: user?.id ?? 'anonymous', username: user?.username ?? 'anonymous' },
        'agent', agentId, `Agent "${agent.name}" updated`,
        { metadata: { fields: Object.keys(updates) } },
      ).catch(() => {});

      return toUiAgent(agent as Record<string, unknown>);
    },
  );
}
