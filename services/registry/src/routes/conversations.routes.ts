import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fetchWithCorrelation } from '@urule/correlation-id';
import type { Database } from '../db/connection.js';
import { conversations, conversationAgents, messages } from '../db/schema/conversations.js';
import { agents } from '../db/schema/agents.js';
import { workspaces } from '../db/schema/workspaces.js';

const createConversationSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1).max(200),
  type: z.string().optional(),
  agentIds: z.array(z.string()).optional(),
});

const createMessageSchema = z.object({
  senderId: z.string().min(1),
  content: z.string().min(1),
  senderType: z.string().optional(),
  contentType: z.string().optional(),
  actionButtons: z.array(z.unknown()).optional(),
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
  // Create conversation
  app.post<{
    Body: { workspaceId: string; title: string; type?: string; agentIds?: string[] };
  }>('/api/v1/conversations', async (request, reply) => {
    const parsed = createConversationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    let { workspaceId } = parsed.data;
    const { title, type, agentIds } = parsed.data;
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

  // List conversations with last_message, message_count, agents
  app.get<{ Querystring: { workspaceId?: string; limit?: string; offset?: string } }>('/api/v1/conversations', async (request) => {
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
  app.get<{ Params: { conversationId: string } }>('/api/v1/conversations/:conversationId', async (request, reply) => {
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
  app.delete<{ Params: { conversationId: string } }>('/api/v1/conversations/:conversationId', async (request, reply) => {
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
    Params: { conversationId: string };
    Body: { senderId: string; senderType?: string; content: string; contentType?: string; actionButtons?: unknown[] };
  }>('/api/v1/conversations/:conversationId/messages', async (request, reply) => {
    const parsed = createMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { conversationId } = request.params;
    const { senderId, senderType, content, contentType, actionButtons } = parsed.data;

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
    Params: { conversationId: string };
    Querystring: { limit?: string };
  }>('/api/v1/conversations/:conversationId/messages', async (request, reply) => {
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
    Params: { conversationId: string };
    Body: z.infer<typeof branchConversationSchema>;
  }>('/api/v1/conversations/:conversationId/branch', async (request, reply) => {
    const parsed = branchConversationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { conversationId } = request.params;
    const { fromMessageId, title, agentIds } = parsed.data;

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
    Params: { conversationId: string };
  }>('/api/v1/conversations/:conversationId/branches', async (request, reply) => {
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
