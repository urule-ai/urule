import { pgTable, varchar, text, jsonb, timestamp, boolean, integer, index } from 'drizzle-orm/pg-core';

export const packages = pgTable('packages', {
  id: varchar('id', { length: 26 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  type: varchar('type', { length: 50 }).notNull(), // personality, skill, mcp_connector, etc.
  description: text('description').notNull().default(''),
  author: varchar('author', { length: 255 }).notNull(),
  repository: varchar('repository', { length: 500 }),
  homepage: varchar('homepage', { length: 500 }),
  license: varchar('license', { length: 50 }),
  verified: boolean('verified').notNull().default(false),
  downloads: integer('downloads').notNull().default(0),
  tags: jsonb('tags').notNull().default([]),
  // Signing: when set, all version publishes for this package must include
  // a valid signature over (manifest || readme || version) verifiable
  // against this key. NULL means anonymous / unsigned (back-compat).
  // `text` so the column can hold the longer Sigstore identity JSON
  // (`{ issuer, subject }`) alongside short Ed25519 base64 keys.
  publisherPubkey: text('publisher_pubkey'),
  pubkeyKind: varchar('pubkey_kind', { length: 20 }).notNull().default('ed25519'),
  // Marketplace: tier governs whether install requires an entitlement.
  // 'free' (default) skips the entitlement check; 'paid' / 'subscription'
  // require a row in `entitlements` for the consuming workspace/user.
  licenseTier: varchar('license_tier', { length: 20 }).notNull().default('free'),
  priceCents: integer('price_cents'),
  paymentProvider: varchar('payment_provider', { length: 20 }),
  paymentLink: varchar('payment_link', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  nameIdx: index('packages_name_idx').on(table.name),
  typeIdx: index('packages_type_idx').on(table.type),
}));
