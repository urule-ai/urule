import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ulid } from 'ulid';
import { eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fetchWithCorrelation } from '@urule/correlation-id';
import { requireMembership, requireRole } from '@urule/authz-middleware';
import type { UruleUser } from '@urule/auth-middleware';
import type { Database } from '../db/connection.js';
import { conversations, conversationAgents, messages } from '../db/schema/conversations.js';
import { agents } from '../db/schema/agents.js';
import { workspaces } from '../db/schema/workspaces.js';
import { bodyWorkspaceResolver, conversationWorkspaceResolver } from '../authz.js';

// auth-middleware decorates `request.uruleUser` at runtime but does not
// publish a Fastify module augmentation. Inline-cast helper — non-null on
// routes guarded by `requireMembership` / `requireRole` (those preHandlers
// 401 before the handler runs when uruleUser is missing).
function getUser(request: FastifyRequest): UruleUser {
  return (request as FastifyRequest & { uruleUser: UruleUser }).uruleUser;
}

const createConversationSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1).max(200),
  type: z.string().optional(),
  agentIds: z.array(z.string()).optional(),
});

// `senderId` deliberately omitted — derived from `request.uruleUser.id` in
// the handler. Reading it from the body let any authenticated workspace
// member record a message under someone else's identity (C-08 / urule#8).
// `z.strictObject` makes the schema **reject** a body with `senderId`
// (returns 400) rather than silently stripping, so spoofing attempts
// surface in CI / logs.
const createMessageSchema = z.strictObject({
  content: z.string().min(1),
  senderType: z.enum(['user', 'agent', 'system']).optional(),
  contentType: z.string().optional(),
  actionButtons: z.array(z.unknown()).optional(),
});

const conversationIdParamsSchema = z.object({ conversationId: z.string() });

const listConversationsQuerySchema = z.object({
  workspaceId: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

const messagesQuerySchema = z.object({
  limit: z.string().optional(),
});

/** Transform a Drizzle conversation row to UI-expected snake_case. */
function toUiConversation(row: Record<string, unknown>) {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    title: row.title,
    type: row.type,
    parent_conversation_id: row.parentConversationId ?? null,
    branched_from_message_id: row.branchedFromMessageId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

const branchConversationSchema = z.object({
  /** ULID of the message in the parent conversation where the branch starts. */
  fromMessageId: z.string().min(1),
  /** Optional title; defaults to "{parent.title} (branch)". */
  title: z.string().min(1).max(200).optional(),
  /** Optional override of the participating agents; defaults to the parent's. */
  agentIds: z.array(z.string()).optional(),
});

/** Transform a Drizzle message row to UI-expected snake_case. */
function toUiMessage(row: Record<string, unknown>) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    sender_id: row.senderId,
    sender_type: row.senderType,
    content: row.content,
    content_type: row.contentType,
    status: row.status,
    token_count: row.tokenCount,
    action_buttons: row.actionButtons ?? [],
    created_at: row.createdAt,
  };
}

/** Transform a Drizzle agent row for conversation context (minimal). */
function toUiAgentSummary(row: Record<string, unknown>) {
  const config = (row.config ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    name: row.name,
    accent_color: config.accentColor ?? '#0db9f2',
  };
}

export function registerConversationRoutes(app: FastifyInstance, db: Database) {
  // Resource-level authz for the write routes.
  const requireConversationMembership = requireMembership(conversationWorkspaceResolver(db));
  const requireBodyMembership = requireMembership(bodyWorkspaceResolver(db));

  // Create conversation
  app.post<{
    Body: z.infer<typeof createConversationSchema>;
  }>('/api/v1/conversations', {
    preHandler: requireBodyMembership,
    schema: {
      tags: ['conversations'],
      summary: 'Create a conversation',
      description: 'Body `{ workspaceId, title, type?, agentIds? }`. Type defaults to `direct` (DM); other values are `group | meeting | channel`. `agentIds` links agent participants — each gets a row in `conversation_agents`.',
      body: createConversationSchema,
    },
  }, async (request, reply) => {
    let { workspaceId } = request.body;
    const { title, type, agentIds } = request.body;
    // Resolve workspace if not provided
    if (!workspaceId || workspaceId === 'default') {
      const [ws] = await db.select().from(workspaces).limit(1);
      workspaceId = ws?.id ?? 'default';
    }
    const id = ulid();
    const now = new Date();

    const [conv] = await db.insert(conversations).values({
      id,
      workspaceId,
      title,
      type: type ?? 'direct',
      createdAt: now,
      updatedAt: now,
    }).returning();

    // Link agents
    if (agentIds?.length) {
      await db.insert(conversationAgents).values(
        agentIds.map(agentId => ({ conversationId: id, agentId }))
      );
    }

    reply.status(201).send(toUiConversation(conv as Record<string, unknown>));
  });

  // List conversations with last_message, message_count, agents — admin only (#95).
  // Cross-workspace; without an admin gate any authenticated user could enumerate
  // every conversation in every workspace. Workspace-scoped callers should use
  // `?workspaceId=` plus their own membership check, OR the dedicated scoped
  // route on workspaces (TODO if not yet present).
  app.get<{ Querystring: z.infer<typeof listConversationsQuerySchema> }>('/api/v1/conversations', {
    preHandler: requireRole('admin'),
    schema: {
      tags: ['conversations'],
      summary: 'List conversations (admin only)',
      description: 'Cross-workspace list — **admin only** (#95). Newest-first by `updatedAt`. Optional `?workspaceId=` filter, `?limit` capped at 100. Each row includes the last message preview, message count, and linked agents — pre-joined for the office-ui chat list. Regular callers should query a workspace-scoped variant.',
      querystring: listConversationsQuerySchema,
    },
  }, async (request) => {
    const { workspaceId } = request.query;
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 100);
    const offset = parseInt(request.query.offset ?? '0', 10);

    let convRows;
    if (workspaceId) {
      convRows = await db.select().from(conversations)
        .where(eq(conversations.workspaceId, workspaceId))
        .orderBy(desc(conversations.updatedAt))
        .limit(limit).offset(offset);
    } else {
      convRows = await db.select().from(conversations)
        .orderBy(desc(conversations.updatedAt))
        .limit(limit).offset(offset);
    }

    const result = await Promise.all(convRows.map(async (conv) => {
      // Get agents for this conversation
      const agentLinks = await db.select().from(conversationAgents)
        .where(eq(conversationAgents.conversationId, conv.id));

      let convAgents: unknown[] = [];
      if (agentLinks.length > 0) {
        convAgents = await Promise.all(
          agentLinks.map(async (link) => {
            const [agent] = await db.select().from(agents).where(eq(agents.id, link.agentId));
            return agent ? toUiAgentSummary(agent as Record<string, unknown>) : null;
          })
        );
        convAgents = convAgents.filter(Boolean);
      }

      // Get message count
      const [countResult] = await db.select({
        count: sql<number>`count(*)::int`,
      }).from(messages).where(eq(messages.conversationId, conv.id));

      // Get last message
      const [lastMsg] = await db.select().from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(desc(messages.createdAt))
        .limit(1);

      return {
        ...toUiConversation(conv as Record<string, unknown>),
        agents: convAgents,
        message_count: countResult?.count ?? 0,
        last_message: lastMsg ? toUiMessage(lastMsg as Record<string, unknown>) : null,
      };
    }));

    return result;
  });

  // Get single conversation
  app.get<{ Params: z.infer<typeof conversationIdParamsSchema> }>('/api/v1/conversations/:conversationId', {
    schema: {
      tags: ['conversations'],
      summary: 'Get conversation by id',
      description: 'Returns the conversation row including the linked agent list. For full message history use `/messages`. 404 CONVERSATION_NOT_FOUND when the id is unknown.',
      params: conversationIdParamsSchema,
    },
  }, async (request, reply) => {
    const { conversationId } = request.params;
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) {
      reply.status(404).send({ error: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${conversationId} not found` } });
      return;
    }

    // Get agents
    const agentLinks = await db.select().from(conversationAgents)
      .where(eq(conversationAgents.conversationId, conversationId));
    let convAgents: unknown[] = [];
    if (agentLinks.length > 0) {
      convAgents = await Promise.all(
        agentLinks.map(async (link) => {
          const [agent] = await db.select().from(agents).where(eq(agents.id, link.agentId));
          return agent ? toUiAgentSummary(agent as Record<string, unknown>) : null;
        })
      );
      convAgents = convAgents.filter(Boolean);
    }

    return { ...toUiConversation(conv as Record<string, unknown>), agents: convAgents };
  });

  // Delete conversation (cascades to messages and conversation_agents)
  app.delete<{ Params: z.infer<typeof conversationIdParamsSchema> }>('/api/v1/conversations/:conversationId', {
    preHandler: requireConversationMembership,
    schema: {
      tags: ['conversations'],
      summary: 'Delete a conversation',
      description: 'Hard-removes the conversation. Cascades message rows + conversation_agents links via the FK. Branches forked from this conversation become top-level orphans (no FK on parent_conversation_id, by design). 204 on success.',
      params: conversationIdParamsSchema,
    },
  }, async (request, reply) => {
    const { conversationId } = request.params;
    const [conv] = await db.delete(conversations).where(eq(conversations.id, conversationId)).returning();
    if (!conv) {
      reply.status(404).send({ error: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${conversationId} not found` } });
      return;
    }
    reply.status(204).send();
  });

  // Post message to conversation
  app.post<{
    Params: z.infer<typeof conversationIdParamsSchema>;
    Body: z.infer<typeof createMessageSchema>;
  }>('/api/v1/conversations/:conversationId/messages', {
    preHandler: requireConversationMembership,
    schema: {
      tags: ['conversations'],
      summary: 'Append a message to a conversation',
      description: 'Body `{ senderType, content, contentType?, actionButtons? }`. `senderId` is **derived from the JWT subject** (`request.uruleUser.id`) — passing one in the body returns 400. SenderType is `user | agent | system` (default `user`); contentType is `text | markdown | tool_call | tool_result`. Used by langgraph-adapter to persist agent replies, and by the office-ui chat box for user turns.',
      params: conversationIdParamsSchema,
      body: createMessageSchema,
    },
  }, async (request, reply) => {
    const { conversationId } = request.params;
    const { senderType, content, contentType, actionButtons } = request.body;
    const senderId = getUser(request).id;

    // Verify conversation exists
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) {
      reply.status(404).send({ error: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${conversationId} not found` } });
      return;
    }

    const id = ulid();
    const [msg] = await db.insert(messages).values({
      id,
      conversationId,
      senderId,
      senderType: senderType ?? 'user',
      content,
      contentType: contentType ?? 'text',
      status: 'delivered',
      tokenCount: 0,
      actionButtons: actionButtons ?? [],
      createdAt: new Date(),
    }).returning();

    // Update conversation timestamp
    await db.update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    // If this is a user message and there are agents in the conversation,
    // trigger AI response by calling the adapter service (fire-and-forget).
    if ((senderType ?? 'user') === 'user') {
      const agentLinks = await db.select().from(conversationAgents)
        .where(eq(conversationAgents.conversationId, conversationId));

      if (agentLinks.length > 0 && agentLinks[0]) {
        const agentId = agentLinks[0].agentId;
        const adapterUrl = process.env['ADAPTER_URL'] ?? 'http://localhost:3002';

        fetchWithCorrelation(`${adapterUrl}/api/v1/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            agentId,
            workspaceId: conv.workspaceId,
            userMessage: content,
          }),
        }).catch(err => {
          app.log.error({ err }, 'Failed to trigger adapter chat');
        });
      }
    }

    reply.status(201).send(toUiMessage(msg as Record<string, unknown>));
  });

  // List messages for conversation
  app.get<{
    Params: z.infer<typeof conversationIdParamsSchema>;
    Querystring: z.infer<typeof messagesQuerySchema>;
  }>('/api/v1/conversations/:conversationId/messages', {
    schema: {
      tags: ['conversations'],
      summary: 'List messages in a conversation',
      description: 'Returns messages chronological-oldest-first up to `?limit` (default 50). The langgraph-adapter chat path reads this when assembling history for the next LLM call.',
      params: conversationIdParamsSchema,
      querystring: messagesQuerySchema,
    },
  }, async (request, reply) => {
    const { conversationId } = request.params;
    const limit = parseInt(request.query.limit ?? '50', 10);

    // Verify conversation exists
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) {
      reply.status(404).send({ error: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${conversationId} not found` } });
      return;
    }

    const msgs = await db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt)
      .limit(limit);

    return msgs.map(m => toUiMessage(m as Record<string, unknown>));
  });

  /**
   * POST /api/v1/conversations/:conversationId/branch
   *   Fork a conversation at a given message. Creates a new
   *   conversation linked to the source via parent_conversation_id +
   *   branched_from_message_id, and copies every message from the
   *   parent up to AND INCLUDING `fromMessageId` into the new
   *   conversation. Subsequent edits in either branch are independent.
   *
   *   Agents are inherited from the parent unless `agentIds` is set
   *   in the body. Title defaults to "<parent.title> (branch)".
   *
   *   404 when the parent conversation or fromMessageId doesn't
   *   exist; 400 when fromMessageId belongs to a different
   *   conversation. 201 with the new conversation row on success.
   */
  app.post<{
    Params: z.infer<typeof conversationIdParamsSchema>;
    Body: z.infer<typeof branchConversationSchema>;
  }>('/api/v1/conversations/:conversationId/branch', {
    preHandler: requireConversationMembership,
    schema: {
      tags: ['conversations'],
      summary: 'Fork a conversation at a message',
      description: "Body `{ fromMessageId, title?, agentIds? }`. Creates a new conversation linked via `parent_conversation_id` + `branched_from_message_id` and copies every message up to and including `fromMessageId` into the branch with fresh ULIDs — subsequent edits in either branch are independent. Inherits parent agents unless `agentIds` overrides. Title defaults to `\"<parent.title> (branch)\"`. 404 on missing parent or message; 400 MESSAGE_NOT_IN_CONVERSATION when `fromMessageId` belongs to a different conversation.",
      params: conversationIdParamsSchema,
      body: branchConversationSchema,
    },
  }, async (request, reply) => {
    const { conversationId } = request.params;
    const { fromMessageId, title, agentIds } = request.body;

    const [parent] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!parent) {
      return reply.code(404).send({
        error: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${conversationId} not found` },
      });
    }

    const [fromMessage] = await db.select().from(messages).where(eq(messages.id, fromMessageId));
    if (!fromMessage) {
      return reply.code(404).send({
        error: { code: 'MESSAGE_NOT_FOUND', message: `Message ${fromMessageId} not found` },
      });
    }
    if (fromMessage.conversationId !== conversationId) {
      return reply.code(400).send({
        error: {
          code: 'MESSAGE_NOT_IN_CONVERSATION',
          message: `Message ${fromMessageId} does not belong to conversation ${conversationId}`,
        },
      });
    }

    const newId = ulid();
    const now = new Date();

    const [created] = await db
      .insert(conversations)
      .values({
        id: newId,
        workspaceId: parent.workspaceId,
        title: title ?? `${parent.title} (branch)`,
        type: parent.type,
        parentConversationId: parent.id,
        branchedFromMessageId: fromMessage.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Copy messages in chronological order, stopping after the
    // selected fromMessageId. We re-key each row with a fresh ULID
    // (messages are append-only and not addressable cross-conv) and
    // preserve every other column so token counts, action buttons,
    // and status flags carry over.
    const parentMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    const fromIdx = parentMessages.findIndex((m) => m.id === fromMessageId);
    const sliceTo = fromIdx === -1 ? parentMessages.length : fromIdx + 1;
    const toCopy = parentMessages.slice(0, sliceTo);
    if (toCopy.length > 0) {
      await db.insert(messages).values(
        toCopy.map((m) => ({
          id: ulid(),
          conversationId: newId,
          senderId: m.senderId,
          senderType: m.senderType,
          content: m.content,
          contentType: m.contentType,
          status: m.status,
          tokenCount: m.tokenCount,
          actionButtons: m.actionButtons,
          createdAt: m.createdAt,
        })),
      );
    }

    // Copy agent participants — caller can override via agentIds.
    let participantIds = agentIds;
    if (!participantIds) {
      const inherited = await db
        .select({ agentId: conversationAgents.agentId })
        .from(conversationAgents)
        .where(eq(conversationAgents.conversationId, conversationId));
      participantIds = inherited.map((r) => r.agentId);
    }
    if (participantIds.length > 0) {
      await db
        .insert(conversationAgents)
        .values(participantIds.map((agentId) => ({ conversationId: newId, agentId })));
    }

    return reply.code(201).send(toUiConversation(created as Record<string, unknown>));
  });

  /**
   * GET /api/v1/conversations/:conversationId/branches
   *   List child conversations forked from this one (one level only —
   *   for a deeper tree the caller iterates).
   */
  app.get<{
    Params: z.infer<typeof conversationIdParamsSchema>;
  }>('/api/v1/conversations/:conversationId/branches', {
    schema: {
      tags: ['conversations'],
      summary: 'List branches forked from this conversation',
      description: 'Returns immediate children newest-first. For a deeper tree, the caller iterates. Empty array (200) when this conversation has no branches — not 404.',
      params: conversationIdParamsSchema,
    },
  }, async (request, reply) => {
    const { conversationId } = request.params;
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) {
      return reply.code(404).send({
        error: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${conversationId} not found` },
      });
    }
    const children = await db
      .select()
      .from(conversations)
      .where(eq(conversations.parentConversationId, conversationId))
      .orderBy(desc(conversations.createdAt));
    return children.map((c) => toUiConversation(c as Record<string, unknown>));
  });
}
