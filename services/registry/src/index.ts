import { loadConfig, validateConfig } from './config.js';
import { buildServer } from './server.js';

async function main() {
  const config = loadConfig();
  validateConfig(config);
  const server = await buildServer(config);

  try {
    await server.listen({ port: config.port, host: config.host });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    server.log.info('Shutting down...');
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
