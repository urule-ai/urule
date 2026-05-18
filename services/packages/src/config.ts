export interface Config {
  port: number;
  host: string;
  natsUrl: string;
  registryUrl: string;
  packagehubUrl: string;
  databaseUrl: string;
  workDir: string;
  serviceName: string;
  /** OpenFGA API URL — when empty, authz runs in in-memory mock mode (dev / no-authz stacks). */
  openfgaUrl: string;
  /** OpenFGA store ID — when empty, the `urule` store is reused/created. */
  openfgaStoreId: string;
  /** Optional OpenFGA model ID — when empty, the latest model in the store is used. */
  openfgaModelId?: string;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    host: process.env['HOST'] ?? '0.0.0.0',
    natsUrl: process.env['NATS_URL'] ?? 'localhost:4222',
    registryUrl: process.env['REGISTRY_URL'] ?? 'http://localhost:3001',
    packagehubUrl: process.env['PACKAGEHUB_URL'] ?? 'http://localhost:3002',
    databaseUrl: process.env['DATABASE_URL'] ?? 'postgres://urule:urule@localhost:5500/packages',
    workDir: process.env['WORK_DIR'] ?? '/tmp/urule-packages',
    serviceName: 'urule-packages',
    openfgaUrl: process.env['OPENFGA_URL'] ?? '',
    openfgaStoreId: process.env['OPENFGA_STORE_ID'] ?? '',
    openfgaModelId: process.env['OPENFGA_MODEL_ID'] || undefined,
  };
}
