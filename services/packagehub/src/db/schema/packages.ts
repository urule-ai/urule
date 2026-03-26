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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  nameIdx: index('packages_name_idx').on(table.name),
  typeIdx: index('packages_type_idx').on(table.type),
}));
