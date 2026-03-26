import { pgTable, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { orgs } from './orgs.js';

export const workspaces = pgTable('workspaces', {
  id: varchar('id', { length: 26 }).primaryKey(),
  orgId: varchar('org_id', { length: 26 }).notNull().references(() => orgs.id),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index('workspaces_org_id_idx').on(table.orgId),
  slugIdx: index('workspaces_slug_idx').on(table.slug),
}));
