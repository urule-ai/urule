import { pgTable, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';

export const runtimes = pgTable('runtimes', {
  id: varchar('id', { length: 26 }).primaryKey(),
  workspaceId: varchar('workspace_id', { length: 26 }).notNull().references(() => workspaces.id),
  provider: varchar('provider', { length: 100 }).notNull(),
  profile: varchar('profile', { length: 100 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('available'),
  capabilities: jsonb('capabilities').notNull().default({}),
  sessionId: varchar('session_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('runtimes_workspace_id_idx').on(table.workspaceId),
}));
