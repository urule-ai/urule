import { pgTable, varchar, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { packages } from './packages.js';

/**
 * Package reviews — one per (package, reviewer). A reviewer is identified
 * by their Urule user id (uruleUserId) since we don't yet have a notion
 * of anonymous reviews and tying ratings to authenticated identity is
 * what lets us prevent ballot-stuffing.
 *
 * Rating is 1-5 (inclusive). Title is required for navigation; body is
 * optional — short ratings without a written review still count toward
 * the average.
 */
export const packageReviews = pgTable('package_reviews', {
  id: varchar('id', { length: 26 }).primaryKey(),
  packageId: varchar('package_id', { length: 26 })
    .notNull()
    .references(() => packages.id, { onDelete: 'cascade' }),
  reviewerId: varchar('reviewer_id', { length: 255 }).notNull(),
  rating: integer('rating').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body').notNull().default(''),
  /** Optional: which version was reviewed (e.g., "0.2.1"). Free-form. */
  version: varchar('version', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  packageIdIdx: index('package_reviews_package_id_idx').on(table.packageId),
  // One review per (package, reviewer) — additional submissions update
  // the existing row via PATCH. UNIQUE constraint enforces it at the
  // database level so concurrent POSTs can't duplicate.
  uniqueReviewer: unique('package_reviews_pkg_reviewer_unique').on(table.packageId, table.reviewerId),
}));
