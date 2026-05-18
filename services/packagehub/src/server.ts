import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { authMiddleware } from '@urule/auth-middleware';
import { correlationIdPlugin } from '@urule/correlation-id';
import { metricsPlugin } from '@urule/observability';
import { createDb } from './db/connection.js';
import { registerPackageRoutes } from './routes/packages.routes.js';
import { registerVersionRoutes } from './routes/versions.routes.js';
import { registerEntitlementRoutes } from './routes/entitlements.routes.js';
import { registerReviewRoutes } from './routes/reviews.routes.js';
import { registerDependencyTreeRoutes } from './routes/dependency-tree.routes.js';
import { registerWebhookRoutes } from './routes/webhooks.routes.js';
import { registerPubkeysRoutes } from './routes/pubkeys.routes.js';
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
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Correlation ID — must be the first plugin so all other middleware logs carry it
  await app.register(correlationIdPlugin);

  // Capture the raw JSON body so the Stripe webhook handler can verify
  // its HMAC signature against the exact bytes Stripe signed. Every
  // other route still receives a parsed object on `request.body`.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        (e as Error & { statusCode?: number }).statusCode = 400;
        done(e, undefined);
      }
    },
  );

  // Prometheus /metrics endpoint
  await app.register(metricsPlugin, { serviceName: 'packagehub' });

  // Register CORS
  const allowedOrigins = (process.env['CORS_ORIGINS'] ?? 'http://localhost:3000').split(',');
  await app.register(cors, { origin: allowedOrigins });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Auth middleware. The Stripe webhook is public (Stripe doesn't speak
  // JWT); the route handler enforces HMAC signature verification instead.
  await app.register(authMiddleware, {
    publicRoutes: [
      '/healthz',
      '/metrics',
      // Catalog browsing is public; publishing (POST /packages, POST .../versions),
      // reviews, and pubkey rotation under the same prefix authenticate.
      'GET /api/v1/packages',
      '/api/v1/webhooks/stripe',
      '/docs',
    ],
  });

  // OpenAPI documentation. Tag descriptions surface in swagger-ui as
  // section headers; per-route tags / summaries / descriptions live in
  // each route's `schema:` field.
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Urule PackageHub API',
        description:
          'Package discovery, version publishing, marketplace entitlements, ' +
          'cryptographic signing + key rotation, ratings, and dependency ' +
          'resolution. See the per-tag sections below for endpoint details.',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3009' }],
      tags: [
        { name: 'packages', description: 'Browse, publish, and look up packages.' },
        { name: 'versions', description: 'Publish + verify cryptographically signed versions.' },
        { name: 'pubkeys', description: 'Publisher pubkey rotation + revocation (proof-of-possession).' },
        { name: 'entitlements', description: 'Marketplace entitlement check + grant for paid / subscription packages.' },
        { name: 'reviews', description: 'Per-package ratings + reviews.' },
        { name: 'dependencies', description: 'Read-only dependency-tree resolution for a published version.' },
        { name: 'webhooks', description: 'Inbound payment-provider webhooks (Stripe).' },
      ],
    },
    transform: jsonSchemaTransform,
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
  registerEntitlementRoutes(app, db);
  registerReviewRoutes(app, db);
  registerDependencyTreeRoutes(app, db);
  registerWebhookRoutes(app, db);
  registerPubkeysRoutes(app, db);

  return app;
}
