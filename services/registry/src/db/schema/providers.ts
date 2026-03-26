import { pgTable, varchar, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';

export const providers = pgTable('providers', {
  id: varchar('id', { length: 26 }).primaryKey(),
  workspaceId: varchar('workspace_id', { length: 26 }).notNull().references(() => workspaces.id),
  name: varchar('name', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(), // claude, openai, ollama, openrouter
  modelName: varchar('model_name', { length: 255 }).notNull(),
  apiKey: text('api_key').notNull().default(''),
  baseUrl: text('base_url').notNull().default(''),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('providers_workspace_id_idx').on(table.workspaceId),
}));
