import { pgTable, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { packages } from './packages.js';

/**
 * Entitlement to use a non-`free` package. Created by Stripe/Lemonsqueezy
 * webhook receivers (future) on successful checkout; manually for `grant`s.
 *
 * Exactly one of (workspaceId, userId) is set — workspace-scoped purchases
 * cover all members of the workspace; user-scoped purchases follow the
 * individual.
 */
export const entitlements = pgTable('entitlements', {
  id: varchar('id', { length: 26 }).primaryKey(),
  packageId: varchar('package_id', { length: 26 })
    .notNull()
    .references(() => packages.id, { onDelete: 'cascade' }),
  workspaceId: varchar('workspace_id', { length: 26 }),
  userId: varchar('user_id', { length: 255 }),
  kind: varchar('kind', { length: 20 }).notNull().default('purchase'),
  externalRef: varchar('external_ref', { length: 255 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  packageIdIdx: index('entitlements_package_id_idx').on(table.packageId),
  workspaceIdx: index('entitlements_workspace_id_idx').on(table.workspaceId, table.packageId),
  userIdx: index('entitlements_user_id_idx').on(table.userId, table.packageId),
}));
