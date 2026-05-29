import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { governanceRoutes } from "../src/routes/governance.routes.js";
import { InMemoryPolicyEngine } from "../src/services/policy-engine.js";
import { InMemoryAuthzEngine } from "../src/services/authz-engine.js";
import { GovernanceService } from "../src/services/governance.js";

/* ------------------------------------------------------------------ *
 * Phase J — admin-only authz on the governance decision oracle.
 *
 * Governance's 4 routes are service-to-service policy/authz endpoints
 * (combined `/decide`, direct OPA `/policy/evaluate`, OpenFGA single
 * `/authz/check`, and batched `/authz/batch-check`). The previous
 * posture was "any authenticated user" — which let any JWT-holder
 * probe policy decisions and OpenFGA tuples across the platform. We
 * now require `roles: ['admin']` via @urule/authz-middleware's
 * `requireRole('admin')`. Services calling governance use admin
 * service-account JWTs.
 *
 * Custom onRequest hook stands in for auth-middleware; the in-memory
 * engines stand in for OPA + OpenFGA. No SKIP_AUTH leakage — this
 * file builds the app per-test instead of calling buildServer.
 * ------------------------------------------------------------------ */

type TestUser = { id: string; username?: string; roles?: string[] } | null;

async function buildApp(opts: { user: TestUser }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorateRequest("uruleUser", null);
  app.addHook("onRequest", async (request) => {
    (request as typeof request & { uruleUser: TestUser }).uruleUser = opts.user;
  });

  const policy = new InMemoryPolicyEngine();
  const authz = new InMemoryAuthzEngine();
  const governance = new GovernanceService(policy, authz);
  await governanceRoutes(app, { governance, policy, authz });
  await app.ready();
  return app;
}

const ADMIN: TestUser = { id: "root", username: "root", roles: ["admin"] };
const MEMBER: TestUser = { id: "alice", username: "alice", roles: ["member"] };
const ROLELESS: TestUser = { id: "noroles", username: "noroles" };
const ANON: TestUser = null;

const DECIDE_PAYLOAD = {
  action: "deploy",
  resource: { type: "workspace", id: "ws-1" },
  subject: { type: "user", id: "alice" },
};

const AUTHZ_CHECK_PAYLOAD = {
  user: "user:alice",
  relation: "member",
  object: "workspace:ws-1",
};

const ROUTES: Array<{
  method: "POST";
  url: string;
  payload: unknown;
  desc: string;
}> = [
  { method: "POST", url: "/api/v1/governance/decide", payload: DECIDE_PAYLOAD, desc: "decide" },
  {
    method: "POST",
    url: "/api/v1/governance/policy/evaluate",
    payload: DECIDE_PAYLOAD,
    desc: "policy/evaluate",
  },
  { method: "POST", url: "/api/v1/governance/authz/check", payload: AUTHZ_CHECK_PAYLOAD, desc: "authz/check" },
  {
    method: "POST",
    url: "/api/v1/governance/authz/batch-check",
    payload: [AUTHZ_CHECK_PAYLOAD],
    desc: "authz/batch-check",
  },
];

describe("Phase J — governance admin-only authz", () => {
  for (const route of ROUTES) {
    describe(route.desc, () => {
      it("admin → 200", async () => {
        const app = await buildApp({ user: ADMIN });
        const res = await app.inject({ method: route.method, url: route.url, payload: route.payload });
        expect(res.statusCode).toBe(200);
      });

      it("non-admin authenticated user → 403", async () => {
        const app = await buildApp({ user: MEMBER });
        const res = await app.inject({ method: route.method, url: route.url, payload: route.payload });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
      });

      it("authenticated user with no roles array → 403", async () => {
        const app = await buildApp({ user: ROLELESS });
        const res = await app.inject({ method: route.method, url: route.url, payload: route.payload });
        expect(res.statusCode).toBe(403);
      });

      it("unauthenticated (uruleUser = null) → 403 (no admin role)", async () => {
        // In production, auth-middleware's onRequest hook rejects with 401
        // when the JWT is missing/invalid — requireRole never runs. This
        // test exercises the second line of defense: even if auth-middleware
        // is bypassed (test fixtures, future misconfiguration, dev tooling),
        // requireRole itself denies a null-user request with 403. The status
        // diverges from production (401 vs 403) by design — we're checking
        // requireRole in isolation, not the full auth+authz chain.
        const app = await buildApp({ user: ANON });
        const res = await app.inject({ method: route.method, url: route.url, payload: route.payload });
        expect(res.statusCode).toBe(403);
      });
    });
  }

  it("admin call still emits the governance-decision audit event (preHandler does not short-circuit it)", async () => {
    const app = await buildApp({ user: ADMIN });
    // Spy on `app.log.info` — governance.routes.ts wires its AuditLogger
    // callback to `app.log.info({ audit: true, topic, ... }, "audit")`. If a
    // preHandler short-circuited the handler, no audit call would happen.
    const infoSpy = vi.spyOn(app.log, "info");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/governance/decide",
      payload: DECIDE_PAYLOAD,
    });
    expect(res.statusCode).toBe(200);

    // The audit emit is fire-and-forget (`audit.configChanged(...).catch(...)`)
    // — the handler returns the response before the publish callback runs.
    // Drain a couple of microtask layers to let the AuditLogger chain settle.
    await new Promise((r) => setImmediate(r));

    // At least one audit emission with the expected shape. The topic on the
    // wire is `urule.audit.config.changed` (governance routes audit decisions
    // through `audit.configChanged`); the entity type inside the event is
    // "governance-decision".
    const auditCalls = infoSpy.mock.calls.filter((args) => {
      const first = args[0];
      if (typeof first !== "object" || first === null) return false;
      const obj = first as Record<string, unknown>;
      if (obj.audit !== true) return false;
      const data = obj.data as Record<string, unknown> | undefined;
      return obj.topic === "urule.audit.config.changed" && data?.entityType === "governance-decision";
    });
    expect(auditCalls.length).toBeGreaterThan(0);
  });
});
