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
import { EventBus } from '@urule/events';
import { metricsPlugin } from '@urule/observability';
import { connect } from 'nats';
import type { Config } from './config.js';
import { createDb } from './db/connection.js';
import { DependencyResolver } from './services/dependency-resolver.js';
import { DrizzleInstallationRepo } from './services/installation-repo.js';
import { ManifestLoader } from './services/manifest-loader.js';
import { PackageManager } from './services/package-manager.js';
import { registerInstallationRoutes } from './routes/installations.routes.js';
import { registerPackageRoutes } from './routes/packages.routes.js';

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
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Map Zod validation failures back to the historical `{ error: 'Validation
  // failed', details: issues }` shape so existing API consumers + tests don't
  // see the type-provider's default Fastify error envelope.
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
  await app.register(metricsPlugin, { serviceName: 'packages' });

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
        title: 'Urule Packages API',
        description:
          'Package install / upgrade / rollback / remove lifecycle for ' +
          'a workspace. Consults packagehub for metadata and entitlement; ' +
          'persists installation history so rollback survives restarts.',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3008' }],
      tags: [
        { name: 'packages', description: 'Install / upgrade / rollback / remove a package in a workspace.' },
        { name: 'installations', description: 'List installations + check for available updates.' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Health check
  app.get('/healthz', async () => ({ status: 'ok', service: config.serviceName }));

  // Services
  const db = createDb(config.databaseUrl);
  const repo = new DrizzleInstallationRepo(db);
  const resolver = new DependencyResolver();
  const loader = new ManifestLoader(config.workDir, config.packagehubUrl);
  const manager = new PackageManager(resolver, loader, repo, config.packagehubUrl);

  // Optional NATS connection — if unreachable, the service still boots
  // and /updates simply skips the publish step. Routes degrade
  // gracefully rather than failing fast on NATS outage.
  let eventBus: EventBus | undefined;
  try {
    const conn = await connect({ servers: config.natsUrl });
    eventBus = new EventBus(conn, { source: 'packages' });
  } catch (err) {
    app.log.warn({ err, natsUrl: config.natsUrl }, 'NATS unavailable; UPDATE_AVAILABLE events will not be published');
  }

  // Routes
  registerInstallationRoutes(app, manager, { eventBus });
  registerPackageRoutes(app, manager);

  return app;
}
