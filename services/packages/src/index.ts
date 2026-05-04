// initOtel must run BEFORE Fastify is loaded so auto-instrumentation can hook
// it at module-load time. Static imports are hoisted; we keep only the OTel
// helper imported statically here and dynamically import everything else.
import { initOtel } from '@urule/observability';

const otelSdk = initOtel('packages');

const { loadConfig } = await import('./config.js');
const { buildServer } = await import('./server.js');

const config = loadConfig();
const server = await buildServer(config);

try {
  await server.listen({ port: config.port, host: config.host });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

const shutdown = async () => {
  server.log.info('Shutting down...');
  await server.close();
  if (otelSdk) await otelSdk.shutdown();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
