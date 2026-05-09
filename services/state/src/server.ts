import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { authMiddleware } from '@urule/auth-middleware';
import { correlationIdPlugin } from '@urule/correlation-id';
import { metricsPlugin } from '@urule/observability';
import { PresenceManager } from './services/presence-manager.js';
import { RoomManager } from './services/room-manager.js';
import { TaskManager } from './services/task-manager.js';
import { WidgetStateManager } from './services/widget-state-manager.js';
import { TypingManager } from './services/typing-manager.js';
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
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: err.validation,
      });
    }
    reply.send(err);
  });

  // Correlation ID — must be the first plugin so all other middleware logs carry it
  await app.register(correlationIdPlugin);

  // Prometheus /metrics endpoint
  await app.register(metricsPlugin, { serviceName: 'state' });

  // Register CORS
  const allowedOrigins = (process.env['CORS_ORIGINS'] ?? 'http://localhost:3000').split(',');
  await app.register(cors, { origin: allowedOrigins });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Auth middleware
  await app.register(authMiddleware, { publicRoutes: ['/healthz', '/metrics', '/docs'] });

  // OpenAPI documentation. Tag descriptions surface in swagger-ui as
  // section headers; per-route tags / summaries / descriptions live in
  // each route's `schema:` field.
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Urule State API',
        description:
          'Ephemeral collaboration state: rooms (collaboration spaces), ' +
          'presence (who is in a room), tasks (work items + ownership ' +
          'transfer), widget configuration, and typing indicators. ' +
          'Currently in-memory; designed to migrate to NATS KV without ' +
          'API changes.',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3007' }],
      tags: [
        { name: 'rooms', description: 'Collaboration rooms (groups of people + agents working on something).' },
        { name: 'presence', description: 'Who is currently in a room and their status.' },
        { name: 'tasks', description: 'Lightweight task records + ownership transfer between users / agents.' },
        { name: 'widgets', description: 'Per-widget-instance configuration persistence.' },
        { name: 'typing', description: 'Short-lived "user is typing" indicators with TTL auto-expiry.' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  const presenceManager = new PresenceManager();
  const roomManager = new RoomManager();
  const taskManager = new TaskManager();
  const widgetStateManager = new WidgetStateManager();
  const typingManager = new TypingManager();

  app.get('/healthz', async () => ({ status: 'ok' }));
  registerStateRoutes(app, { presenceManager, roomManager, taskManager, widgetStateManager, typingManager });
  return app;
}
