// initOtel must run BEFORE Fastify is loaded so auto-instrumentation can hook
// it at module-load time. Static imports are hoisted; we keep only the OTel
// helper imported statically here and dynamically import everything else.
import { initOtel } from '@urule/observability';

const otelSdk = initOtel('state');

const { buildServer } = await import('./server.js');
const { loadConfig, validateConfig } = await import('./config.js');

const config = loadConfig();
validateConfig(config);
const app = await buildServer();
await app.listen({ port: config.port, host: config.host });
console.log(`urule-state listening on ${config.host}:${config.port}`);

const shutdown = async () => {
  console.log('Shutting down...');
  await app.close();
  if (otelSdk) await otelSdk.shutdown();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
