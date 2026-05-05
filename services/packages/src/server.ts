import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { authMiddleware } from '@urule/auth-middleware';
import { correlationIdPlugin } from '@urule/correlation-id';
import { EventBus } from '@urule/events';
import { metricsPlugin } from '@urule/observability';
import { connect } from 'nats';
import type { Config } from './config.js';
import { DependencyResolver } from './services/dependency-resolver.js';
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

  // OpenAPI documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Urule Packages API',
        description: 'Package install/upgrade/remove lifecycle',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3008' }],
      tags: [{ name: 'packages' }, { name: 'installations' }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Health check
  app.get('/healthz', async () => ({ status: 'ok', service: config.serviceName }));

  // Services
  const resolver = new DependencyResolver();
  const loader = new ManifestLoader(config.workDir, config.packagehubUrl);
  const manager = new PackageManager(resolver, loader);

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
