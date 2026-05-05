import { pgTable, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

export const installations = pgTable('installations', {
  id: varchar('id', { length: 26 }).primaryKey(),
  workspaceId: varchar('workspace_id', { length: 26 }).notNull(),
  packageName: varchar('package_name', { length: 255 }).notNull(),
  version: varchar('version', { length: 50 }).notNull().default(''),
  type: varchar('type', { length: 30 }).notNull().default('unknown'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  config: jsonb('config').notNull().default({}),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workspaceIdx: index('installations_workspace_idx').on(table.workspaceId),
  workspacePkgIdx: index('installations_workspace_pkg_idx').on(table.workspaceId, table.packageName),
}));
