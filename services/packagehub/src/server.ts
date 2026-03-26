import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authMiddleware } from '@urule/auth-middleware';
import { createDb } from './db/connection.js';
import { registerPackageRoutes } from './routes/packages.routes.js';
import { registerVersionRoutes } from './routes/versions.routes.js';
import { errorHandler } from './middleware/error-handler.js';
import type { Config } from './config.js';

export async function buildServer(config: Config) {
  const app = Fastify({
    logger: true,
    genReqId: () => crypto.randomUUID(),
  });

  // Register CORS
  await app.register(cors, { origin: true });

  // Auth middleware
  await app.register(authMiddleware, { publicRoutes: ['/healthz', '/api/v1/packages'] });

  // Error handler
  app.setErrorHandler(errorHandler);

  // Health check
  app.get('/healthz', async () => ({ status: 'ok', service: config.serviceName }));

  // Database
  const db = createDb(config.databaseUrl);

  // Routes
  registerPackageRoutes(app, db);
  registerVersionRoutes(app, db);

  return app;
}
