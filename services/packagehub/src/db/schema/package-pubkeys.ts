import { pgTable, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { packages } from './packages.js';

/*
 * Per-package publisher pubkey rotation history.
 *
 * Original §6.3 floor stored a single `publisher_pubkey` on the
 * `packages` row. That made rotation impossible: turning over the
 * column invalidates every previously-published version's signature.
 * This table holds every pubkey a publisher has ever associated with
 * a package + an `active` / `revoked` status.
 *
 * Verify path walks ACTIVE rows. Adding a new key (rotation) and
 * revoking an old one both require a proof-of-possession signature
 * from any currently-active key — so possession of the original
 * private key is the gate, with no admin override path. Loss of every
 * private key for a package is intentionally unrecoverable on the
 * server side; publisher can ask Urule operators for a manual UPDATE,
 * but that's deliberately a last-resort process not exposed via API.
 *
 * `packages.publisher_pubkey` is preserved as the "primary display"
 * key (what the TrustPanel surfaces). The migration backfills a row
 * here for every existing non-null publisher_pubkey, so verify works
 * with no API churn.
 */
export const packagePubkeys = pgTable('package_pubkeys', {
  id: varchar('id', { length: 26 }).primaryKey(),
  packageId: varchar('package_id', { length: 26 })
    .notNull()
    .references(() => packages.id, { onDelete: 'cascade' }),
  // `pubkey` stores either a base64 Ed25519 raw pubkey (≤44 chars) OR — when
  // `pubkey_kind = 'sigstore-oidc'` — a JSON document with the expected
  // `{ issuer, subject }` identity that any cosign bundle must match. The
  // identity strings (e.g., a GitHub Actions workflow path) easily exceed
  // 64 chars, so the column is `text` rather than the Ed25519-era varchar.
  pubkey: text('pubkey').notNull(),
  pubkeyKind: varchar('pubkey_kind', { length: 20 }).notNull().default('ed25519'),
  status: varchar('status', { length: 12 }).notNull().default('active'),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => ({
  packageIdx: index('package_pubkeys_package_idx').on(table.packageId),
  packageActiveIdx: index('package_pubkeys_package_active_idx').on(table.packageId, table.status),
}));
