import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

/**
 * Route-level tests for urule-packagehub.
 *
 * These tests exercise Zod validation on request bodies, which runs
 * *before* any database call. We point the server at an unreachable DB
 * URL so no real Postgres is needed — validation rejects the request
 * before the query layer is ever reached.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({
    port: 0,
    host: '127.0.0.1',
    databaseUrl: 'postgres://fake:fake@127.0.0.1:1/fake',
    natsUrl: 'nats://127.0.0.1:1',
    serviceName: 'packagehub-test',
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ─── Health check ────────────────────────────────────────────────────

describe('GET /healthz', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('packagehub-test');
  });
});

// ─── POST /api/v1/packages validation ───────────────────────────────

describe('POST /api/v1/packages — validation', () => {
  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages',
      payload: {
        type: 'skill',
        author: 'tester',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });

  it('returns 400 when author is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages',
      payload: {
        name: 'my-package',
        type: 'skill',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });

  it('returns 400 when repository is not a valid URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages',
      payload: {
        name: 'my-package',
        type: 'skill',
        author: 'tester',
        repository: 'not-a-url',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });
});

// ─── POST /api/v1/packages/:name/versions validation ────────────────

describe('POST /api/v1/packages/:name/versions — validation', () => {
  it('returns 400 when version is not valid semver', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/my-package/versions',
      payload: {
        version: 'not-semver',
        manifest: { entry: 'index.ts' },
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });

  it('returns 400 when manifest is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/my-package/versions',
      payload: {
        version: '1.0.0',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });
});
