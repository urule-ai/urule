# Database Migrations

Urule services that own a Postgres schema use [Drizzle Kit](https://orm.drizzle.team/kit-docs/overview) for versioned, file-based migrations. This document covers how to generate, apply, roll back, and test them.

## Services with managed schemas

| Service | Database | Schema source | Migrations dir |
|---|---|---|---|
| registry | `registry` | [services/registry/src/db/schema/](../services/registry/src/db/schema/) | [services/registry/migrations/](../services/registry/migrations/) |
| packagehub | `packagehub` | [services/packagehub/src/db/schema/](../services/packagehub/src/db/schema/) | [services/packagehub/migrations/](../services/packagehub/migrations/) |
| mcp-gateway | `mcp_gateway` | mcp-gateway/src/db/schema/ (standalone repo) | mcp-gateway/migrations/ (standalone repo) |

Other services use NATS KV (state, runtime-broker), Temporal (approvals), or no persistence.

## Generating a migration

After editing any `src/db/schema/*.ts` file in one of the three services above:

```bash
cd services/registry         # or packagehub / mcp-gateway
npm run db:generate
```

This diffs the schema files against `migrations/meta/_journal.json` and writes a new `migrations/NNNN_<name>.sql` file plus updated metadata. Commit both the SQL and the `meta/` updates.

Conventions:
- One migration per logical schema change. Don't bundle unrelated edits.
- Migration filenames are auto-generated; don't rename them.
- Inspect the SQL before committing. Drizzle is conservative but column renames are emitted as `DROP + ADD` (data-destroying) — if you intended a rename, edit the SQL by hand to use `ALTER TABLE … RENAME COLUMN`.

## Applying migrations

Locally, against a running postgres:

```bash
DATABASE_URL=postgres://urule:urule@localhost:5500/registry \
  npm run db:migrate
```

`db:migrate` runs `drizzle-kit migrate`, which:
1. Connects to `DATABASE_URL`.
2. Creates the `drizzle.__drizzle_migrations` tracking table if absent.
3. Applies any migrations whose hash is not yet recorded.
4. Records each applied migration's hash + timestamp.

Hash mismatch (e.g. someone hand-edited a previously-applied migration) will fail loudly rather than silently re-running.

## Initial-schema vs. migration

Today's [infra/compose/init-{registry,packagehub}-schema.sh](../infra/compose/) scripts run as Postgres `docker-entrypoint-initdb.d` hooks on **first** container init. They create tables idempotently with `CREATE TABLE IF NOT EXISTS`. They do NOT seed `drizzle.__drizzle_migrations`, so the first `db:migrate` against a Postgres instance that was bootstrapped by those scripts will try to re-create existing tables.

Until the init scripts are retired (see roadmap §4.1 line 185 — adding migrate as a Compose step), run migrations only against a Postgres that was started **without** the init scripts, or seed the tracking table manually:

```sql
-- one-time, against a DB that was bootstrapped by the init script:
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT
);
-- then for each migration already represented in the init script:
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
  VALUES ('<hash from migrations/meta/0000_snapshot.json>', extract(epoch from now())::bigint * 1000);
```

The cleaner long-term fix is to delete the init scripts and rely on `db:migrate` for both fresh installs and upgrades. Tracked as roadmap §4.1.

## Rolling back

Drizzle Kit does not generate down-migrations. To roll back:

1. Write a new migration (`db:generate`) that undoes the previous schema change.
2. Apply it (`db:migrate`).

This keeps the migration history strictly forward-only, which avoids ambiguity about "current schema state" but means you must plan migrations carefully (no destructive changes without a verified rollback path).

For an emergency rollback after a failed deploy:
1. Restore the database from the most recent backup.
2. Re-run `db:migrate` up to the last known-good migration (drizzle-kit applies them in order; you can manually delete entries from `drizzle.__drizzle_migrations` to "skip" the bad one if you've also reverted the SQL file in git).

## Testing migrations

Two layers of testing.

**Generation correctness** — covered by typecheck. Schema files are TypeScript; if they don't compile, `db:generate` fails before producing SQL.

**Apply correctness** — apply the migration against a throwaway Postgres and run integration tests. The existing [infra/compose/docker-compose.tests.yaml](../infra/compose/docker-compose.tests.yaml) starts a Postgres with the init scripts; for migration testing specifically, start one without them and run `db:migrate` first:

```bash
docker run -d --name urule-pg-test -p 5599:5432 \
  -e POSTGRES_USER=urule -e POSTGRES_PASSWORD=urule -e POSTGRES_DB=registry \
  postgres:16-alpine
DATABASE_URL=postgres://urule:urule@localhost:5599/registry \
  npm --prefix services/registry run db:migrate
# … run integration tests against the migrated DB …
docker rm -f urule-pg-test
```

A future improvement (roadmap §4.1) is to add a `migrate` step to the test compose file so this is a single command.

## Adding a new schema-owning service

1. Add `drizzle-orm` and `drizzle-kit` to the service's `package.json`.
2. Create `drizzle.config.ts` at the service root pointing at `./src/db/schema/*.ts` and `./migrations`.
3. Add `db:generate` and `db:migrate` scripts to `package.json`.
4. Run `db:generate` to produce the initial `0000_…sql`.
5. Document the new service in this file and in roadmap §4.1.
