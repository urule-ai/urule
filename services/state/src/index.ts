import { buildServer } from './server.js';
import { loadConfig, validateConfig } from './config.js';

const config = loadConfig();
validateConfig(config);
const app = await buildServer();
await app.listen({ port: config.port, host: config.host });
console.log(`urule-state listening on ${config.host}:${config.port}`);

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
