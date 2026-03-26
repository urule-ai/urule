import { pgTable, varchar, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { agents } from './agents.js';

export const conversations = pgTable('conversations', {
  id: varchar('id', { length: 26 }).primaryKey(),
  workspaceId: varchar('workspace_id', { length: 26 }).notNull().references(() => workspaces.id),
  title: varchar('title', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull().default('direct'), // direct, group, meeting, channel
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('conversations_workspace_id_idx').on(table.workspaceId),
}));

export const conversationAgents = pgTable('conversation_agents', {
  conversationId: varchar('conversation_id', { length: 26 }).notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  agentId: varchar('agent_id', { length: 26 }).notNull().references(() => agents.id),
});

export const messages = pgTable('messages', {
  id: varchar('id', { length: 26 }).primaryKey(),
  conversationId: varchar('conversation_id', { length: 26 }).notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderId: varchar('sender_id', { length: 255 }).notNull(),
  senderType: varchar('sender_type', { length: 20 }).notNull().default('user'), // user, agent, system
  content: text('content').notNull().default(''),
  contentType: varchar('content_type', { length: 50 }).notNull().default('text'), // text, markdown, tool_call, tool_result
  status: varchar('status', { length: 20 }).notNull().default('delivered'), // sending, streaming, delivered, failed
  tokenCount: integer('token_count').notNull().default(0),
  actionButtons: jsonb('action_buttons').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
