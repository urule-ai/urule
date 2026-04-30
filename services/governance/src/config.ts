export interface Config {
  port: number;
  host: string;
  opaUrl: string;
  openfgaUrl: string;
  openfgaStoreId: string;
  natsUrl: string;
  serviceName: string;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    opaUrl: process.env.OPA_URL ?? "http://localhost:8181",
    openfgaUrl: process.env.OPENFGA_URL ?? "http://localhost:8082",
    openfgaStoreId: process.env.OPENFGA_STORE_ID ?? "",
    natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
    serviceName: process.env.SERVICE_NAME ?? "urule-governance",
  };
}

export function validateConfig(config: Config): void {
  const missing: string[] = [];
  if (!process.env.NATS_URL) missing.push("NATS_URL");
  if (missing.length > 0) {
    throw new Error(`[${config.serviceName}] Missing required env vars: ${missing.join(", ")}`);
  }
  // OPENFGA_STORE_ID stays warn-only — some dev setups intentionally skip authz.
  if (!config.openfgaStoreId) {
    console.warn(`[${config.serviceName}] Config warnings: OPENFGA_STORE_ID (empty)`);
  }
}
