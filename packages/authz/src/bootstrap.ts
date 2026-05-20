import { createAuthzClient } from './client.js';
import type { AuthzClient } from './types.js';

/** Minimal logger shape — satisfied by Fastify's `app.log` and by `console`. */
export interface BootstrapLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Connection config for {@link bootstrapAuthzClient}. */
export interface AuthzBootstrapConfig {
  /** OpenFGA API URL. When empty, an in-memory mock client is used. */
  openfgaUrl: string;
  /** OpenFGA store ID. When empty, the `urule` store is reused/created. */
  openfgaStoreId?: string;
  /** Optional model ID; when empty the latest model in the store is used. */
  openfgaModelId?: string;
}

/** Store name self-provisioned when no `openfgaStoreId` is supplied. */
const STORE_NAME = 'urule';

/**
 * Resolve the OpenFGA store to use — reuse the existing `urule` store if
 * present, otherwise create it. Uses the raw OpenFGA HTTP API so callers need
 * not depend on `@openfga/sdk` directly.
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
  const { authorization_models } = (await res.json()) as { authorization_models?: unknown[] };
  return (authorization_models?.length ?? 0) > 0;
}

/**
 * Build the `AuthzClient` a service runs with — the shared OpenFGA bootstrap
 * every Urule service uses.
 *
 * - No `openfgaUrl` → in-memory mock client (dev / no-authz stacks). Tuple
 *   writes become harmless no-ops that survive only the process lifetime.
 * - `openfgaUrl` set → self-bootstrap: reuse/create the `urule` store, write
 *   `URULE_AUTH_MODEL` if the store has no model yet, return the live client.
 *
 * Service availability is never coupled to OpenFGA: if bootstrap fails (e.g.
 * OpenFGA is down at startup) the error is logged and the mock client is
 * returned rather than crash-looping the service.
 */
export async function bootstrapAuthzClient(
  config: AuthzBootstrapConfig,
  log: BootstrapLogger,
): Promise<AuthzClient> {
  if (!config.openfgaUrl) {
    log.warn({}, 'authz: OPENFGA_URL unset — using in-memory mock authz client');
    const { createMockAuthzClient } = await import('./testing.js');
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
    const { createMockAuthzClient } = await import('./testing.js');
    return createMockAuthzClient();
  }
}
