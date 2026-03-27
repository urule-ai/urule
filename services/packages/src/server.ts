import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { authMiddleware } from '@urule/auth-middleware';
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
    genReqId: () => crypto.randomUUID(),
  });

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

  // Routes
  registerInstallationRoutes(app, manager);
  registerPackageRoutes(app, manager);

  return app;
}
