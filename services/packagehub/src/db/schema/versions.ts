import { pgTable, varchar, text, jsonb, timestamp, boolean, index } from 'drizzle-orm/pg-core';
import { packages } from './packages.js';

export const packageVersions = pgTable('package_versions', {
  id: varchar('id', { length: 26 }).primaryKey(),
  packageId: varchar('package_id', { length: 26 }).notNull().references(() => packages.id),
  version: varchar('version', { length: 50 }).notNull(),
  manifest: jsonb('manifest').notNull(), // full package manifest
  readme: text('readme').notNull().default(''),
  checksum: varchar('checksum', { length: 128 }),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  yanked: boolean('yanked').notNull().default(false),
  // Signature over the canonical (manifest || readme || version) digest.
  // NULL when the parent package has no publisher_pubkey (back-compat path).
  signature: varchar('signature', { length: 256 }),
  signatureKind: varchar('signature_kind', { length: 20 }).notNull().default('ed25519'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
}, (table) => ({
  packageIdIdx: index('package_versions_package_id_idx').on(table.packageId),
}));
