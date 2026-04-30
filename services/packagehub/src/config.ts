export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  natsUrl: string;
  serviceName: string;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    host: process.env['HOST'] ?? '0.0.0.0',
    databaseUrl: process.env['DATABASE_URL'] ?? '',
    natsUrl: process.env['NATS_URL'] ?? 'localhost:4222',
    serviceName: 'urule-packagehub',
  };
}

export function validateConfig(config: Config): void {
  const missing: string[] = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!process.env['NATS_URL']) missing.push('NATS_URL');
  if (missing.length > 0) {
    throw new Error(
      `[${config.serviceName}] Missing required env vars: ${missing.join(', ')}`,
    );
  }
}
