import { pgTable, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';

export const agents = pgTable('agents', {
  id: varchar('id', { length: 26 }).primaryKey(),
  workspaceId: varchar('workspace_id', { length: 26 }).notNull().references(() => workspaces.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  personalityPackId: varchar('personality_pack_id', { length: 26 }),
  skillPacks: jsonb('skill_packs').notNull().default([]),
  mcpBindings: jsonb('mcp_bindings').notNull().default([]),
  status: varchar('status', { length: 20 }).notNull().default('idle'),
  config: jsonb('config').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('agents_workspace_id_idx').on(table.workspaceId),
  statusIdx: index('agents_status_idx').on(table.workspaceId, table.status),
}));
