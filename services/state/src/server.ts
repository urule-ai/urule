import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { authMiddleware } from '@urule/auth-middleware';
import { PresenceManager } from './services/presence-manager.js';
import { RoomManager } from './services/room-manager.js';
import { TaskManager } from './services/task-manager.js';
import { WidgetStateManager } from './services/widget-state-manager.js';
import { registerStateRoutes } from './routes/state.routes.js';

export async function buildServer() {
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
  await app.register(authMiddleware, { publicRoutes: ['/healthz', '/docs'] });

  // OpenAPI documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Urule State API',
        description: 'Room presence, task ownership, and widget state',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3007' }],
      tags: [{ name: 'rooms' }, { name: 'presence' }, { name: 'tasks' }, { name: 'widgets' }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  const presenceManager = new PresenceManager();
  const roomManager = new RoomManager();
  const taskManager = new TaskManager();
  const widgetStateManager = new WidgetStateManager();

  app.get('/healthz', async () => ({ status: 'ok' }));
  registerStateRoutes(app, { presenceManager, roomManager, taskManager, widgetStateManager });
  return app;
}
