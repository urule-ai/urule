import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` reads this and writes SQL to ./migrations/.
// `npm run db:migrate` applies pending migrations against DATABASE_URL.
export default defineConfig({
  schema: './src/db/schema/*.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ??
      'postgres://urule:urule@localhost:5500/packagehub',
  },
});
