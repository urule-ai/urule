import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { authMiddleware } from '@urule/auth-middleware';
import { createDb } from './db/connection.js';
import { registerPackageRoutes } from './routes/packages.routes.js';
import { registerVersionRoutes } from './routes/versions.routes.js';
import { errorHandler } from './middleware/error-handler.js';
import type { Config } from './config.js';

export async function buildServer(config: Config) {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            hostname: request.hostname,
            remoteAddress: request.ip,
          };
        },
      },
    },
    genReqId: () => crypto.randomUUID(),
  });

  // Register CORS
  const allowedOrigins = (process.env['CORS_ORIGINS'] ?? 'http://localhost:3000').split(',');
  await app.register(cors, { origin: allowedOrigins });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Auth middleware
  await app.register(authMiddleware, { publicRoutes: ['/healthz', '/api/v1/packages', '/docs'] });

  // OpenAPI documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Urule PackageHub API',
        description: 'Package discovery, search, and version management',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3009' }],
      tags: [{ name: 'packages' }, { name: 'versions' }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

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
