import { pgTable, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { agents } from './agents.js';

export const agentMemories = pgTable('agent_memories', {
  id: varchar('id', { length: 26 }).primaryKey(),
  agentId: varchar('agent_id', { length: 26 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  kind: varchar('kind', { length: 50 }).notNull().default('note'),
  tags: jsonb('tags').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentIdIdx: index('agent_memories_agent_id_idx').on(table.agentId),
}));
