export interface Config {
  port: number;
  host: string;
  natsUrl: string;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 3007),
    host: process.env.HOST ?? '0.0.0.0',
    natsUrl: process.env.NATS_URL ?? 'nats://localhost:4222',
  };
}

export function validateConfig(_config: Config): void {
  const missing: string[] = [];
  if (!process.env.NATS_URL) missing.push('NATS_URL');
  if (missing.length > 0) {
    throw new Error(`[urule-state] Missing required env vars: ${missing.join(', ')}`);
  }
}
