import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { Config } from "./config.js";
import { authMiddleware } from "@urule/auth-middleware";
import { correlationIdPlugin } from "@urule/correlation-id";
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
  });

  app.setErrorHandler(errorHandler);

  // Correlation ID — must be the first plugin so all other middleware logs carry it
  await app.register(correlationIdPlugin);

  // Register CORS
  const allowedOrigins = (process.env["CORS_ORIGINS"] ?? "http://localhost:3000").split(",");
  await app.register(cors, { origin: allowedOrigins });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // Auth middleware
  await app.register(authMiddleware, { publicRoutes: ["/healthz", "/docs"] });

  // OpenAPI documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Urule Governance API',
        description: 'OPA policy + OpenFGA authorization gateway',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3004' }],
      tags: [{ name: 'governance' }, { name: 'policy' }, { name: 'authz' }],
    },
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
