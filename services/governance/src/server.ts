import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Config } from "./config.js";
import { authMiddleware } from "@urule/auth-middleware";
import { correlationIdPlugin } from "@urule/correlation-id";
import { metricsPlugin } from "@urule/observability";
import { errorHandler } from "./middleware/error-handler.js";
import { governanceRoutes } from "./routes/governance.routes.js";
import { InMemoryPolicyEngine } from "./services/policy-engine.js";
import { InMemoryAuthzEngine } from "./services/authz-engine.js";
import { GovernanceService } from "./services/governance.js";

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

  app.setErrorHandler(errorHandler);

  // Correlation ID — must be the first plugin so all other middleware logs carry it
  await app.register(correlationIdPlugin);

  // Prometheus /metrics endpoint
  await app.register(metricsPlugin, { serviceName: "governance" });

  // Register CORS
  const allowedOrigins = (process.env["CORS_ORIGINS"] ?? "http://localhost:3000").split(",");
  await app.register(cors, { origin: allowedOrigins });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // Auth middleware
  await app.register(authMiddleware, { publicRoutes: ["/healthz", "/metrics", "/docs"] });

  // OpenAPI documentation. Tag descriptions surface in swagger-ui as
  // section headers; per-route tags / summaries / descriptions live in
  // each route's `schema:` field.
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Urule Governance API',
        description:
          'OPA policy evaluation + OpenFGA relationship-based access ' +
          'control. Combines both signals into a single decide() that ' +
          'every callsite uses for "may this actor perform this action?" ' +
          'questions; emits an audit event on every decision.',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3004' }],
      tags: [
        { name: 'governance', description: 'Combined policy + authz decision (the primary callsite).' },
        { name: 'policy', description: 'Direct OPA policy evaluation — useful for previewing rules.' },
        { name: 'authz', description: 'Direct OpenFGA relationship checks (single + batch).' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  app.get("/healthz", async () => {
    return { status: "ok", service: config.serviceName };
  });

  const policy = new InMemoryPolicyEngine();
  const authz = new InMemoryAuthzEngine();
  const governance = new GovernanceService(policy, authz);

  await governanceRoutes(app, { governance, policy, authz });

  return app;
}
