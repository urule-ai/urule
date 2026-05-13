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

const agentIdParamsSchema = z.object({ agentId: z.string() });
const wsIdParamsSchema = z.object({ wsId: z.string() });
const agentMemoryParamsSchema = z.object({ agentId: z.string(), memoryId: z.string() });

const paginationQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
});

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
  // List all agents (across all workspaces) — admin only (#25).
  app.get<{ Querystring: z.infer<typeof paginationQuerySchema> }>('/api/v1/agents', {
    schema: {
      tags: ['agents'],
      summary: 'List all agents (admin only)',
      description: 'Cross-workspace list — **admin only**. Regular callers should use `/api/v1/workspaces/:wsId/agents` to list a workspace\'s agents. Pagination via `?limit` (capped 100) + `?offset`. Each row is decorated with its associated provider record (joined on `agent.config.provider_id`).',
      querystring: paginationQuerySchema,
    },
  }, async (request, reply) => {
    // #25: without a guard, any authenticated user sees every workspace's
    // agents. Require the `admin` role. TODO(#4): once the authz layer can
    // scope to the caller's workspaces, prefer that over a blanket admin gate
    // (and switch the office-ui's agent-list queries to /workspaces/:wsId/agents).
    const user = (request as any).uruleUser;
    if (!user?.roles?.includes('admin')) {
      reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Admin role required — use /api/v1/workspaces/:wsId/agents to list a workspace’s agents',
        },
      });
      return;
    }
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
  app.get<{ Params: z.infer<typeof wsIdParamsSchema>; Querystring: z.infer<typeof paginationQuerySchema> }>('/api/v1/workspaces/:wsId/agents', {
    schema: {
      tags: ['agents'],
      summary: 'List agents in a workspace',
      description: 'Pagination via `?limit` (capped 100) + `?offset`. Empty array (200) when the workspace has no agents — not 404. The Office UI agent directory hits this directly.',
      params: wsIdParamsSchema,
      querystring: paginationQuerySchema,
    },
  }, async (request) => {
    const { wsId } = request.params;
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 100);
    const offset = parseInt(request.query.offset ?? '0', 10);
    const rows = await db.select().from(agents).where(eq(agents.workspaceId, wsId)).limit(limit).offset(offset);
    return rows.map(row => toUiAgent(row as Record<string, unknown>));
  });

  // Register agent
  app.post<{
    Body: z.infer<typeof createAgentSchema>;
  }>('/api/v1/agents', {
    schema: {
      tags: ['agents'],
      summary: 'Register an agent',
      description: 'Body `{ workspaceId, name, description?, config? }`. `config` carries the agent\'s personality + provider_id + system prompt; the langgraph-adapter chat path reads it on every turn. New agents land in `status: idle`.',
      body: createAgentSchema,
    },
  }, async (request, reply) => {
    let { workspaceId } = request.body;
    const { name, description, config } = request.body;
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
  app.get<{ Params: z.infer<typeof agentIdParamsSchema> }>('/api/v1/agents/:agentId', {
    schema: {
      tags: ['agents'],
      summary: 'Get agent by id (with provider join)',
      description: 'Returns the agent row with its provider record joined in. 404 AGENT_NOT_FOUND when the id is unknown.',
      params: agentIdParamsSchema,
    },
  }, async (request, reply) => {
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
  app.get<{ Params: z.infer<typeof agentIdParamsSchema> }>('/api/v1/agents/:agentId/metrics', {
    schema: {
      tags: ['agents'],
      summary: 'Agent activity metrics (real, derived)',
      description: 'Returns `{ messages_sent, messages_sent_24h, conversations_participated, last_active }`. Computed live from the messages + conversation_agents tables — the `messages_sender_id_idx` covers the aggregate. CPU/memory metrics return 0 deliberately (agents are logical actors, not OS processes).',
      params: agentIdParamsSchema,
    },
  }, async (request, reply) => {
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
  app.get<{ Params: z.infer<typeof agentIdParamsSchema> }>('/api/v1/agents/:agentId/health', {
    schema: {
      tags: ['agents'],
      summary: 'Agent health snapshot',
      description: 'Returns `{ status, lastActive, recentErrors, healthy }` — drives the agent-detail page\'s health badge. Healthy iff (a) agent\'s status is `active` or `idle`, (b) last activity within 24h, (c) no errors in the last 100 messages.',
      params: agentIdParamsSchema,
    },
  }, async (request, reply) => {
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
  app.get<{ Params: z.infer<typeof agentIdParamsSchema> }>('/api/v1/agents/:agentId/conversations', {
    schema: {
      tags: ['agents'],
      summary: "Agent's conversations (stub)",
      description: "Stub returning `[]` today. Filtering /conversations by `?agentId=` is the proper wire-up; this endpoint exists so the office-ui agent-detail page doesn't 404.",
      params: agentIdParamsSchema,
    },
  }, async () => []);

  // Agent logs stub
  app.get<{ Params: z.infer<typeof agentIdParamsSchema> }>('/api/v1/agents/:agentId/logs', {
    schema: {
      tags: ['agents'],
      summary: "Agent's activity log (stub)",
      description: 'Stub returning `[]` today. Filtering /logs by `?actor_id=:agentId&actor_type=agent` is the canonical query; this endpoint is here for forward-compat.',
      params: agentIdParamsSchema,
    },
  }, async () => []);

  // Agent memories — Drizzle-backed CRUD against the agent_memories table.
  app.get<{ Params: z.infer<typeof agentIdParamsSchema>; Querystring: z.infer<typeof paginationQuerySchema> }>(
    '/api/v1/agents/:agentId/memories',
    {
      schema: {
        tags: ['agents'],
        summary: "List agent memories",
        description: "Returns the agent's persistent memory rows newest-first. Pagination via `?limit` (capped 100) + `?offset`. Memories are scoped per-agent — different agents in the same workspace don't share memory.",
        params: agentIdParamsSchema,
        querystring: paginationQuerySchema,
      },
    },
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

  app.post<{ Params: z.infer<typeof agentIdParamsSchema>; Body: z.infer<typeof memoryCreateSchema> }>(
    '/api/v1/agents/:agentId/memories',
    {
      schema: {
        tags: ['agents'],
        summary: 'Add an agent memory',
        description: 'Body `{ content, kind?, tags? }`. `kind` defaults to `note` (other values: `goal`, `fact`, `correction`). 404 AGENT_NOT_FOUND if the agent id is unknown.',
        params: agentIdParamsSchema,
        body: memoryCreateSchema,
      },
    },
    async (request, reply) => {
      const { agentId } = request.params;
      const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
      if (!agent) {
        return reply.code(404).send({ error: { code: 'AGENT_NOT_FOUND', message: `Agent ${agentId} not found` } });
      }
      const [memory] = await db.insert(agentMemories).values({
        id: ulid(),
        agentId,
        content: request.body.content,
        kind: request.body.kind ?? 'note',
        tags: request.body.tags ?? [],
      }).returning();
      return reply.code(201).send(memory);
    },
  );

  app.delete<{ Params: z.infer<typeof agentMemoryParamsSchema> }>(
    '/api/v1/agents/:agentId/memories/:memoryId',
    {
      schema: {
        tags: ['agents'],
        summary: 'Delete an agent memory',
        description: '204 on success, 404 MEMORY_NOT_FOUND if the id is unknown or belongs to a different agent.',
        params: agentMemoryParamsSchema,
      },
    },
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
  app.post<{ Params: z.infer<typeof agentIdParamsSchema>; Body: z.infer<typeof agentStatusSchema> }>(
    '/api/v1/agents/:agentId/status',
    {
      schema: {
        tags: ['agents'],
        summary: "Update agent status",
        description: "Body `{ status }` — `idle | active | thinking | offline | error`. Used by the chat path (langgraph-adapter flips the status to `thinking` on incoming user message, back to `idle` on completion). Emits an `entityUpdated` audit event on every change.",
        params: agentIdParamsSchema,
        body: agentStatusSchema,
      },
    },
    async (request, reply) => {
      const { agentId } = request.params;
      const { status } = request.body;
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
  app.patch<{ Params: z.infer<typeof agentIdParamsSchema>; Body: z.infer<typeof updateAgentSchema> }>(
    '/api/v1/agents/:agentId',
    {
      schema: {
        tags: ['agents'],
        summary: 'Update an agent',
        description: 'Partial update of any agent field — name, description, config (system prompt, provider_id, etc.). 404 AGENT_NOT_FOUND when the id is unknown.',
        params: agentIdParamsSchema,
        body: updateAgentSchema,
      },
    },
    async (request, reply) => {
      const { agentId } = request.params;
      const updates = request.body;

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
