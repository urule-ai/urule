import { fileURLToPath } from 'node:url';
import { orgTuple, parentTuple, workspaceTuple, type AuthzClient, type RelationTuple } from '@urule/authz';
import type { Database } from './db/connection.js';
import { orgs } from './db/schema/orgs.js';
import { workspaces } from './db/schema/workspaces.js';

/** Default owner for backfilled tuples — the SKIP_AUTH mock user (`dev-user-001`). */
const DEFAULT_BOOTSTRAP_OWNER = 'dev-user-001';

interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Write a tuple only when it does not already exist — keeps the backfill idempotent. */
async function ensureTuple(authz: AuthzClient, tuple: RelationTuple, log: Logger): Promise<boolean> {
  try {
    const { allowed } = await authz.check(tuple.user, tuple.relation, tuple.object);
    if (allowed) return false;
  } catch {
    // check unsupported / failed — fall through and let the write decide.
  }
  try {
    await authz.writeTuples([tuple]);
    return true;
  } catch (err) {
    // Most likely the tuple already exists (OpenFGA rejects duplicate writes).
    log.warn({ err, tuple }, 'authz-backfill: tuple write skipped');
    return false;
  }
}

/**
 * Backfill OpenFGA ownership tuples for every org and workspace already in the
 * registry database (the seeded demo tenant + any pre-authz data). Idempotent —
 * safe to run on every startup and as a one-shot job.
 *
 * Each org gets an `owner` tuple for `ownerUserId`; each workspace gets an
 * `owner` tuple plus a `parent` link to its org so membership inheritance flows.
 */
export async function backfillAuthzTuples(opts: {
  db: Database;
  authz: AuthzClient;
  ownerUserId?: string;
  log: Logger;
}): Promise<{ written: number; total: number }> {
  const { db, authz, log } = opts;
  const ownerUserId = opts.ownerUserId ?? process.env['AUTHZ_BOOTSTRAP_OWNER'] ?? DEFAULT_BOOTSTRAP_OWNER;

  const orgRows = await db.select({ id: orgs.id }).from(orgs);
  const wsRows = await db.select({ id: workspaces.id, orgId: workspaces.orgId }).from(workspaces);

  let written = 0;
  let total = 0;

  for (const org of orgRows) {
    total += 1;
    if (await ensureTuple(authz, orgTuple(ownerUserId, 'owner', org.id), log)) written += 1;
  }
  for (const ws of wsRows) {
    total += 2;
    if (await ensureTuple(authz, workspaceTuple(ownerUserId, 'owner', ws.id), log)) written += 1;
    if (await ensureTuple(authz, parentTuple('workspace', ws.id, 'org', ws.orgId), log)) written += 1;
  }

  log.info(
    { ownerUserId, orgs: orgRows.length, workspaces: wsRows.length, written, total },
    'authz-backfill: complete',
  );
  return { written, total };
}

/** CLI entrypoint — used by the `registry-authz-seed` one-shot compose service. */
async function main(): Promise<void> {
  const { loadConfig } = await import('./config.js');
  const { createDb } = await import('./db/connection.js');
  const { buildAuthzClient } = await import('./authz.js');

  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  const authz = await buildAuthzClient(config, console);
  await backfillAuthzTuples({ db, authz, log: console });
  process.exit(0);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error({ err }, 'authz-backfill: failed');
    process.exit(1);
  });
}
