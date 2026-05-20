import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authMiddleware } from '@urule/auth-middleware';
import { authzMiddleware } from '@urule/authz-middleware';
import { createMockAuthzClient } from '@urule/authz/testing';
import type { AuthzClient } from '@urule/authz';
import { registerOrgRoutes } from '../../src/routes/orgs.routes.js';
import { registerWorkspaceRoutes } from '../../src/routes/workspaces.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';

/* ------------------------------------------------------------------ *
 * PR B1 — verify that creating an org / workspace writes the OpenFGA
 * ownership tuples that PR B2's membership checks will read.
 * `authMiddleware({ skipAuth: true })` injects MOCK_USER (`dev-user-001`).
 * ------------------------------------------------------------------ */

/** Minimal insert-only mock DB — each insert() returns the next configured row set. */
function makeMockDb(insertReturns: unknown[][]) {
  let idx = 0;
  return {
    insert: vi.fn(() => {
      const rows = insertReturns[idx++] ?? [];
      return {
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(rows)),
        })),
      };
    }),
  } as never;
}

async function buildApp(authz: AuthzClient) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(authMiddleware, { skipAuth: true });
  await app.register(authzMiddleware, { authzClient: authz });
  app.setErrorHandler(errorHandler);
  registerOrgRoutes(app, makeMockDb([[{ id: 'org-row', name: 'Acme', slug: 'acme', status: 'active' }]]));
  registerWorkspaceRoutes(
    app,
    makeMockDb([[{ id: 'ws-row', orgId: 'org-1', name: 'Team', slug: 'team', status: 'active' }]]),
  );
  return app;
}

describe('POST /api/v1/orgs — authz tuple writes', () => {
  it('writes an `owner` tuple for the authenticated user', async () => {
    const authz = createMockAuthzClient();
    const app = await buildApp(authz);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      payload: { name: 'Acme', slug: 'acme' },
    });

    expect(res.statusCode).toBe(201);
    const ownerTuples = authz.tuples.filter((t) => t.relation === 'owner');
    expect(ownerTuples).toHaveLength(1);
    expect(ownerTuples[0]!.user).toBe('user:dev-user-001');
    expect(ownerTuples[0]!.object).toMatch(/^org:/);
  });

  it('still returns 201 when the authz client throws', async () => {
    const failing: AuthzClient = {
      ...createMockAuthzClient(),
      writeTuples: vi.fn(() => Promise.reject(new Error('openfga down'))),
    };
    const app = await buildApp(failing);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      payload: { name: 'Acme', slug: 'acme' },
    });

    expect(res.statusCode).toBe(201);
  });
});

describe('POST /api/v1/workspaces — authz tuple writes', () => {
  it('writes an `owner` tuple and a `parent` link to the org', async () => {
    const authz = createMockAuthzClient();
    const app = await buildApp(authz);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { orgId: 'org-1', name: 'Team', slug: 'team' },
    });

    expect(res.statusCode).toBe(201);

    const owner = authz.tuples.find((t) => t.relation === 'owner');
    expect(owner?.user).toBe('user:dev-user-001');
    expect(owner?.object).toMatch(/^workspace:/);

    const parent = authz.tuples.find((t) => t.relation === 'parent');
    expect(parent?.user).toBe('org:org-1');
    expect(parent?.object).toMatch(/^workspace:/);
    // owner + parent objects address the same new workspace
    expect(parent?.object).toBe(owner?.object);
  });
});
