import { pgTable, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { installations } from './installations.js';

/**
 * Append-only stack of (installationId, version) rows. The "stack top" is
 * the row with the most recent recordedAt — rollback walks the second
 * row, deletes the top, and updates installations.version. Cascades on
 * installation delete so removing an install doesn't orphan history.
 */
export const versionHistory = pgTable('version_history', {
  id: varchar('id', { length: 26 }).primaryKey(),
  installationId: varchar('installation_id', { length: 26 })
    .notNull()
    .references(() => installations.id, { onDelete: 'cascade' }),
  version: varchar('version', { length: 50 }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  installationIdx: index('version_history_installation_idx').on(table.installationId),
}));
