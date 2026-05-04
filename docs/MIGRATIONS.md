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

## How fresh installs get the schema

A `*-migrate` one-shot Compose service runs `npx drizzle-kit migrate` against each schema-owning database before the long-running app service starts. The pattern uses a multi-stage Dockerfile target named `migrator` (see [services/registry/Dockerfile](../services/registry/Dockerfile), [services/packagehub/Dockerfile](../services/packagehub/Dockerfile), [mcp-gateway/Dockerfile](../../mcp-gateway/Dockerfile)) that includes drizzle-kit + the migrations dir; the runner stage stays lean (`npm ci --omit=dev` keeps drizzle-kit out of production).

**Pre-build step required.** Standalone services (langgraph-adapter, approvals, etc.) consume `@urule/*` workspace packages via `file:../urule/packages/*` refs. Their Docker builds COPY the consumed packages' `dist/` into the build context, so those `dist/` directories must exist on the host *before* `docker compose build`. Run once before bringing the stack up:

```bash
npm --prefix urule run build:all
npm --prefix orchestrator-contract run build
docker compose -f urule/infra/compose/docker-compose.phase6.yaml build
docker compose -f urule/infra/compose/docker-compose.phase6.yaml up -d
```

Monorepo services (registry, packagehub, state, office-ui) build their workspace deps inside the Docker builder stage and don't need the pre-build, but running it first is cheap and keeps the `dist/` directories in sync for IDE / test workflows.

Compose wires it via `service_completed_successfully`:

```yaml
registry-migrate:
  build: { context: ../../services/registry, target: migrator }
  environment: { DATABASE_URL: postgres://urule:urule@postgres:5432/registry }
  depends_on: { postgres: { condition: service_healthy } }
  restart: 'no'

registry:
  depends_on:
    registry-migrate:
      condition: service_completed_successfully
```

Seed data (`seed-registry.sql`, `seed-packagehub.sql`) loads via separate one-shot `*-seed` services that depend on the matching migrator. Seeds use `INSERT ... ON CONFLICT DO NOTHING` so they're safe to re-run.

Idempotency: drizzle-kit tracks applied migrations in `drizzle.__drizzle_migrations` and skips already-applied ones, so bringing the stack up a second time without a fresh volume is a no-op.

**Upgrading from a stack that used the retired `init-*-schema.sh` scripts**: those scripts created tables but never wrote to `drizzle.__drizzle_migrations`, so the first `db:migrate` against an old DB volume will fail trying to re-create the existing tables. Two recovery paths:

1. **Recommended (local dev)**: drop the volume and start fresh — `docker compose -f infra/compose/docker-compose.phase6.yaml down -v && up -d`. Seed services rebuild the demo data.
2. **Preserve data**: manually mark the 0000 migration as applied:
   ```sql
   CREATE SCHEMA IF NOT EXISTS drizzle;
   CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
     id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT
   );
   INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
     VALUES ('<hash from migrations/meta/0000_snapshot.json>',
             extract(epoch from now())::bigint * 1000);
   ```
   Subsequent migrations (0001+) will then apply normally.

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

**Apply correctness** — apply the migration against a throwaway Postgres and run integration tests. Easiest is the same `*-migrate` Compose service used in the main stack, run alone:

```bash
docker compose -f infra/compose/docker-compose.phase6.yaml \
  up -d postgres registry-migrate packagehub-migrate
# both migrators exit 0 when done; check with:
docker compose -f infra/compose/docker-compose.phase6.yaml ps registry-migrate
```

For an isolated throwaway DB (no compose):

```bash
docker run -d --name urule-pg-test -p 5599:5432 \
  -e POSTGRES_USER=urule -e POSTGRES_PASSWORD=urule -e POSTGRES_DB=registry \
  postgres:16-alpine
DATABASE_URL=postgres://urule:urule@localhost:5599/registry \
  npm --prefix services/registry run db:migrate
# … run integration tests against the migrated DB …
docker rm -f urule-pg-test
```

## Adding a new schema-owning service

1. Add `drizzle-orm` and `drizzle-kit` to the service's `package.json`.
2. Create `drizzle.config.ts` at the service root pointing at `./src/db/schema/*.ts` and `./migrations`.
3. Add `db:generate` and `db:migrate` scripts to `package.json`.
4. Run `db:generate` to produce the initial `0000_…sql`.
5. Add a `migrator` stage to the service's Dockerfile (see [services/registry/Dockerfile](../services/registry/Dockerfile) for the canonical shape — copies `drizzle.config.ts`, `migrations/`, `src/db/`, and runs `npx drizzle-kit migrate`).
6. Add a `<service>-migrate` Compose service in [infra/compose/docker-compose.phase6.yaml](../infra/compose/docker-compose.phase6.yaml) (and phase1 if applicable) and make the long-running service `depends_on` it with `condition: service_completed_successfully`.
7. If the service needs Postgres extensions (e.g. `pg_trgm`), add them via a custom migration (`npx drizzle-kit generate --custom --name <name>`).
8. Document the new service in this file.
