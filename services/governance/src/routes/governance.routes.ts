import type { FastifyInstance, FastifyRequest } from "fastify";
import type { UruleUser } from "@urule/auth-middleware";
import type { GovernanceService } from "../services/governance.js";
import type { PolicyEngine } from "../services/policy-engine.js";
import type { AuthzEngine } from "../services/authz-engine.js";
import type {
  AuthzCheckInput,
  GovernanceRequest,
  PolicyInput,
} from "../types.js";
import { AuditLogger } from "@urule/events";

const audit = new AuditLogger("governance", (topic, data) => {
  console.log(JSON.stringify({ audit: true, topic, ...data as Record<string, unknown> }));
});

interface Dependencies {
  governance: GovernanceService;
  policy: PolicyEngine;
  authz: AuthzEngine;
}

// auth-middleware decorates `request.uruleUser` at runtime but does not
// publish a Fastify module augmentation; mirror its inline-cast pattern.
function getUser(request: FastifyRequest): UruleUser | null {
  return (request as FastifyRequest & { uruleUser: UruleUser | null }).uruleUser;
}

export async function governanceRoutes(
  app: FastifyInstance,
  deps: Dependencies,
): Promise<void> {
  app.post<{ Body: GovernanceRequest }>(
    "/api/v1/governance/decide",
    async (request, reply) => {
      const decision = await deps.governance.decide(request.body);

      const body = request.body;
      const user = getUser(request);
      const workspaceId = typeof body.context?.["workspaceId"] === "string"
        ? (body.context["workspaceId"] as string)
        : undefined;
      audit.configChanged(
        { id: user?.id ?? body.subject.id ?? "system", username: user?.username ?? "system" },
        "governance-decision", body.subject.id,
        `Governance decision: ${decision.allowed ? "allowed" : "denied"}`,
        { workspaceId, metadata: { action: body.action, decision } },
      ).catch((err: unknown) => {
        request.log.warn({ err, route: "/governance/decide" }, "audit emit failed");
      });

      return reply.send(decision);
    },
  );

  app.post<{ Body: PolicyInput }>(
    "/api/v1/governance/policy/evaluate",
    async (request, reply) => {
      const result = await deps.policy.evaluate(request.body);

      const body = request.body;
      const user = getUser(request);
      audit.configChanged(
        { id: user?.id ?? "system", username: user?.username ?? "system" },
        "policy", body.action,
        `Policy evaluated: ${result.allowed ? "allowed" : "denied"}`,
        { metadata: { input: body, result } },
      ).catch((err: unknown) => {
        request.log.warn({ err, route: "/governance/policy/evaluate" }, "audit emit failed");
      });

      return reply.send(result);
    },
  );

  app.post<{ Body: AuthzCheckInput }>(
    "/api/v1/governance/authz/check",
    async (request, reply) => {
      const result = await deps.authz.check(request.body);

      const body = request.body;
      if (!result.allowed) {
        const [resourceType = "resource", resourceId = "unknown"] = body.object.split(":");
        audit.accessDenied(
          { id: body.user, username: body.user },
          resourceType, resourceId,
          `Access denied: ${body.relation} on ${resourceType}`,
          { metadata: { input: body, result } },
        ).catch((err: unknown) => {
          request.log.warn({ err, route: "/governance/authz/check" }, "audit emit failed");
        });
      }

      return reply.send(result);
    },
  );

  app.post<{ Body: AuthzCheckInput[] }>(
    "/api/v1/governance/authz/batch-check",
    async (request, reply) => {
      const results = await deps.authz.batchCheck(request.body);
      return reply.send(results);
    },
  );
}
