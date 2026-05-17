import { createAuthzClient, type AuthzClient } from '@urule/authz';
import { createMockAuthzClient } from '@urule/authz/testing';
import type { Config } from './config.js';

/** Minimal logger shape — satisfied by Fastify's `app.log` and by `console`. */
interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Store name the registry self-provisions when no OPENFGA_STORE_ID is supplied. */
const STORE_NAME = 'urule';

/**
 * Resolve the OpenFGA store the registry should use.
 *
 * Reuses the existing store named `urule` if present, otherwise creates it.
 * Uses the raw OpenFGA HTTP API (same approach as the governance service's
 * `AuthzEngine`) so the registry need not depend on `@openfga/sdk` directly.
 */
async function bootstrapStore(openfgaUrl: string): Promise<string> {
  const base = openfgaUrl.replace(/\/$/, '');

  const listRes = await fetch(`${base}/stores`);
  if (!listRes.ok) {
    throw new Error(`OpenFGA list-stores failed: ${listRes.status}`);
  }
  const { stores } = (await listRes.json()) as { stores?: { id: string; name: string }[] };
  const existing = stores?.find((s) => s.name === STORE_NAME);
  if (existing) return existing.id;

  const createRes = await fetch(`${base}/stores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: STORE_NAME }),
  });
  if (!createRes.ok) {
    throw new Error(`OpenFGA create-store failed: ${createRes.status}`);
  }
  const { id } = (await createRes.json()) as { id: string };
  return id;
}

/** Whether the store already has at least one authorization model written. */
async function hasModel(openfgaUrl: string, storeId: string): Promise<boolean> {
  const base = openfgaUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/stores/${storeId}/authorization-models?page_size=1`);
  if (!res.ok) return false;
  const { authorization_models } = (await res.json()) as {
    authorization_models?: unknown[];
  };
  return (authorization_models?.length ?? 0) > 0;
}

/**
 * Build the AuthzClient the registry runs with.
 *
 * - No `OPENFGA_URL` → in-memory mock client (dev / no-authz stacks). Tuple
 *   writes become harmless no-ops and survive only for the process lifetime.
 * - `OPENFGA_URL` set → self-bootstrap: reuse/create the `urule` store, write
 *   `URULE_AUTH_MODEL` if the store has no model yet, return the live client.
 *
 * Registry availability is never coupled to OpenFGA: if bootstrap fails (e.g.
 * OpenFGA is down at startup) the registry logs the error and falls back to the
 * mock client rather than crash-looping.
 */
export async function buildAuthzClient(config: Config, log: Logger): Promise<AuthzClient> {
  if (!config.openfgaUrl) {
    log.warn({}, 'authz: OPENFGA_URL unset — using in-memory mock authz client');
    return createMockAuthzClient();
  }

  try {
    const storeId = config.openfgaStoreId || (await bootstrapStore(config.openfgaUrl));
    const client = createAuthzClient({
      apiUrl: config.openfgaUrl,
      storeId,
      modelId: config.openfgaModelId,
    });

    if (!(await hasModel(config.openfgaUrl, storeId))) {
      const modelId = await client.ensureModel();
      log.info({ storeId, modelId }, 'authz: wrote URULE_AUTH_MODEL to OpenFGA store');
    }

    log.info({ storeId }, 'authz: connected to OpenFGA');
    return client;
  } catch (err) {
    log.error({ err }, 'authz: OpenFGA bootstrap failed — falling back to mock authz client');
    return createMockAuthzClient();
  }
}
