import { pgTable, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
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
  // #33 — the Stripe webhook keys idempotency on (packageId, externalRef). The
  // SELECT-then-INSERT guard alone races under at-least-once delivery (two
  // concurrent deliveries both find no row, both insert). This backs the guard
  // with a DB constraint so a duplicate delivery can only ever yield one row.
  // `externalRef` is NULL for manual grants — Postgres treats NULLs as distinct,
  // so multiple manual grants for the same package are unaffected.
  externalRefUq: uniqueIndex('entitlements_package_external_ref_uq').on(table.packageId, table.externalRef),
}));
