import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { authMiddleware } from '@urule/auth-middleware';
import { errorHandler } from '../src/middleware/error-handler.js';
import { governanceRoutes } from '../src/routes/governance.routes.js';
import { GovernanceService } from '../src/services/governance.js';
import { InMemoryPolicyEngine } from '../src/services/policy-engine.js';
import { InMemoryAuthzEngine } from '../src/services/authz-engine.js';

// HTTP-integration tests for the four /api/v1/governance/* routes.
// Complements `governance.test.ts` (unit tests on `GovernanceService`) by
// exercising the Fastify wiring — Zod type-provider validation, the
// `{ error: 'Validation failed', details }` envelope from `errorHandler`,
// and audit emission via `console.log`. We don't go through `buildServer()`
// because (a) we need access to the in-memory engines to seed allow/deny
// outcomes, and (b) the `cors`/`rate-limit`/`swagger` plugins are tested
// elsewhere. We do mirror the *minimal* subset of `buildServer` plumbing
// that affects route behaviour: validator/serializer compilers, the error
// handler, and the auth middleware (in its permissive default mode so
// `request.uruleUser` is decorated as `null`).

interface AuditEnvelope {
  audit: true;
  topic: string;
  type: string;
  source: string;
  data: {
    actorId: string;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string;
    service: string;
    description: string;
    workspaceId?: string;
    metadata?: Record<string, unknown>;
  };
  [k: string]: unknown;
}

function auditEvents(spy: ReturnType<typeof vi.spyOn>): AuditEnvelope[] {
  return spy.mock.calls
    .map((call) => call[0])
    .filter((arg): arg is string => typeof arg === 'string')
    .map((s) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        return null;
      }
    })
    .filter(
      (o): o is AuditEnvelope =>
        !!o &&
        typeof o === 'object' &&
        (o as Record<string, unknown>)['audit'] === true,
    );
}

interface BuildOpts {
  seedPolicy?: (p: InMemoryPolicyEngine) => void;
  seedAuthz?: (a: InMemoryAuthzEngine) => void;
}

async function buildTestApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(authMiddleware, { publicRoutes: ['/healthz'] });

  const policy = new InMemoryPolicyEngine();
  const authz = new InMemoryAuthzEngine();
  opts.seedPolicy?.(policy);
  opts.seedAuthz?.(authz);
  const governance = new GovernanceService(policy, authz);

  await governanceRoutes(app, { governance, policy, authz });
  await app.ready();
  return app;
}

// `audit.configChanged(...).catch(...)` is fire-and-forget. Even though the
// publish sink is synchronous, the chain still goes through one microtask
// before `console.log` fires. Wait one macrotask after each inject so the
// audit microtasks have flushed before assertions run.
async function flushAudit(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

const validSubject = { type: 'user', id: 'alice' };
const validResource = { type: 'document', id: 'doc-1' };

describe('governance routes — HTTP integration', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('POST /api/v1/governance/decide', () => {
    it('returns 400 with Validation failed envelope on missing body', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/governance/decide',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string; details: unknown };
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('returns 200 with allow on the happy path and emits a config-changed audit event', async () => {
      const app = await buildTestApp({
        seedPolicy: (p) => p.addRule('read', true, 'Read allowed by policy'),
        seedAuthz: (a) => a.addTuple('user:alice', 'read', 'document:doc-1'),
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/governance/decide',
        payload: {
          action: 'read',
          subject: validSubject,
          resource: validResource,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        allowed: boolean;
        policyResult: { allowed: boolean };
        authzResult: { allowed: boolean };
        requiresApproval: boolean;
      };
      expect(body.allowed).toBe(true);
      expect(body.policyResult.allowed).toBe(true);
      expect(body.authzResult.allowed).toBe(true);
      expect(body.requiresApproval).toBe(false);

      await flushAudit();
      const events = auditEvents(consoleSpy);
      expect(events).toHaveLength(1);
      const evt = events[0]!;
      expect(evt.topic).toBe('urule.audit.config.changed');
      expect(evt.data.entityType).toBe('governance-decision');
      expect(evt.data.metadata?.['action']).toBe('read');
    });

    it('returns 200 with deny when authz lacks the tuple, and the audit description says denied', async () => {
      const app = await buildTestApp({
        seedPolicy: (p) => p.addRule('write', true, 'Write allowed by policy'),
        // No authz tuple — authz denies.
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/governance/decide',
        payload: {
          action: 'write',
          subject: validSubject,
          resource: validResource,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        allowed: boolean;
        policyResult: { allowed: boolean };
        authzResult: { allowed: boolean };
      };
      expect(body.allowed).toBe(false);
      expect(body.policyResult.allowed).toBe(true);
      expect(body.authzResult.allowed).toBe(false);

      await flushAudit();
      const events = auditEvents(consoleSpy);
      expect(events).toHaveLength(1);
      expect(events[0]!.data.description).toContain('denied');
    });
  });

  describe('POST /api/v1/governance/policy/evaluate', () => {
    it('returns 400 when the required `subject` field is missing', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/governance/policy/evaluate',
        payload: {
          action: 'read',
          resource: validResource,
          // subject missing
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string; details: unknown };
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('returns 200 with the policy result on a valid input and emits a `policy` audit event', async () => {
      const app = await buildTestApp({
        seedPolicy: (p) => p.addRule('read', true, 'Read allowed by policy'),
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/governance/policy/evaluate',
        payload: {
          action: 'read',
          subject: validSubject,
          resource: validResource,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { allowed: boolean; reasons: string[] };
      expect(body.allowed).toBe(true);
      expect(body.reasons).toContain('Read allowed by policy');

      await flushAudit();
      const events = auditEvents(consoleSpy);
      expect(events).toHaveLength(1);
      const evt = events[0]!;
      expect(evt.topic).toBe('urule.audit.config.changed');
      expect(evt.data.entityType).toBe('policy');
      expect(evt.data.entityId).toBe('read');
    });
  });

  describe('POST /api/v1/governance/authz/check', () => {
    it('returns 400 when the required `relation` field is missing', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/governance/authz/check',
        payload: {
          user: 'user:alice',
          object: 'document:doc-1',
          // relation missing
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string; details: unknown };
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('returns 200 with allowed=true and does NOT emit an audit event on allow', async () => {
      const app = await buildTestApp({
        seedAuthz: (a) => a.addTuple('user:alice', 'read', 'document:doc-1'),
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/governance/authz/check',
        payload: {
          user: 'user:alice',
          relation: 'read',
          object: 'document:doc-1',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ allowed: true });

      await flushAudit();
      // Allows are intentionally not audited (would be too noisy).
      expect(auditEvents(consoleSpy)).toHaveLength(0);
    });

    it('returns 200 with allowed=false and emits an access.denied audit event on deny', async () => {
      const app = await buildTestApp(); // no tuple seeded
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/governance/authz/check',
        payload: {
          user: 'user:alice',
          relation: 'read',
          object: 'document:doc-1',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ allowed: false });

      await flushAudit();
      const events = auditEvents(consoleSpy);
      expect(events).toHaveLength(1);
      const evt = events[0]!;
      expect(evt.topic).toBe('urule.audit.access.denied');
      expect(evt.data.entityType).toBe('document');
      expect(evt.data.entityId).toBe('doc-1');
      expect(evt.data.actorId).toBe('user:alice');
    });
  });

  describe('POST /api/v1/governance/authz/batch-check', () => {
    it('returns 400 when the body is an object rather than an array', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/governance/authz/batch-check',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string; details: unknown };
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('returns 400 when an array element is missing a required field', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/governance/authz/batch-check',
        payload: [{ user: 'user:alice', relation: 'read' /* object missing */ }],
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string; details: unknown };
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('returns 200 with results in input order — mixed allow/deny', async () => {
      const app = await buildTestApp({
        seedAuthz: (a) => {
          a.addTuple('user:a', 'read', 'doc:1');
          a.addTuple('user:b', 'write', 'doc:2');
        },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/governance/authz/batch-check',
        payload: [
          { user: 'user:a', relation: 'read', object: 'doc:1' },
          { user: 'user:c', relation: 'read', object: 'doc:1' },
          { user: 'user:b', relation: 'write', object: 'doc:2' },
        ],
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        { allowed: true },
        { allowed: false },
        { allowed: true },
      ]);
    });

    it('does not emit any audit events even when the batch contains denials', async () => {
      const app = await buildTestApp({
        seedAuthz: (a) => a.addTuple('user:a', 'read', 'doc:1'),
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/governance/authz/batch-check',
        payload: [
          { user: 'user:a', relation: 'read', object: 'doc:1' },
          { user: 'user:c', relation: 'read', object: 'doc:1' },
          { user: 'user:d', relation: 'write', object: 'doc:2' },
        ],
      });
      await flushAudit();
      // batch-check is intentionally silent — caller is expected to log
      // denials at its own layer (see the route's `description`).
      expect(auditEvents(consoleSpy)).toHaveLength(0);
    });
  });
});
