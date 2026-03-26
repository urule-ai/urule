import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { Config } from "./config.js";
import { authMiddleware } from "@urule/auth-middleware";
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
    genReqId: () => crypto.randomUUID(),
  });

  app.setErrorHandler(errorHandler);

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // Auth middleware
  await app.register(authMiddleware, { publicRoutes: ["/healthz"] });

  app.get("/healthz", async () => {
    return { status: "ok", service: config.serviceName };
  });

  const policy = new InMemoryPolicyEngine();
  const authz = new InMemoryAuthzEngine();
  const governance = new GovernanceService(policy, authz);

  await governanceRoutes(app, { governance, policy, authz });

  return app;
}
