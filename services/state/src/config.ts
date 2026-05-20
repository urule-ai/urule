export interface Config {
  port: number;
  host: string;
  natsUrl: string;
  /** OpenFGA API URL — when empty, authz runs in in-memory mock mode (dev / no-authz stacks). */
  openfgaUrl: string;
  /** OpenFGA store ID — when empty, the `urule` store is reused/created. */
  openfgaStoreId: string;
  /** Optional OpenFGA model ID — when empty, the latest model in the store is used. */
  openfgaModelId?: string;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 3007),
    host: process.env.HOST ?? '0.0.0.0',
    natsUrl: process.env.NATS_URL ?? 'nats://localhost:4222',
    openfgaUrl: process.env.OPENFGA_URL ?? '',
    openfgaStoreId: process.env.OPENFGA_STORE_ID ?? '',
    openfgaModelId: process.env.OPENFGA_MODEL_ID || undefined,
  };
}

export function validateConfig(config: Config): void {
  const missing: string[] = [];
  if (!process.env.NATS_URL) missing.push('NATS_URL');
  if (missing.length > 0) {
    throw new Error(`[urule-state] Missing required env vars: ${missing.join(', ')}`);
  }

  // OpenFGA stays warn-only — dev stacks intentionally run without authz, in
  // which case the service falls back to an in-memory mock authz client.
  if (!config.openfgaUrl) {
    console.warn('[urule-state] Config warnings: OPENFGA_URL (empty) — authz runs in in-memory mock mode');
  }
}
