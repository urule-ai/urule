import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';

describe('Package Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const config = loadConfig();
    app = await buildServer(config);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz returns 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('urule-packages');
  });

  it('POST /api/v1/packages/install with missing workspaceId returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/install',
      payload: {
        packageName: 'my-package',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('POST /api/v1/packages/install with missing packageName returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/install',
      payload: {
        workspaceId: 'ws-1',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('POST /api/v1/packages/install with empty packageName returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/install',
      payload: {
        workspaceId: 'ws-1',
        packageName: '',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('POST /api/v1/packages/:id/upgrade with empty body still succeeds (all fields optional)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/some-install-id/upgrade',
      payload: {},
    });

    // Should not be 400 — validation passes because all fields are optional.
    // It may be 404 or 409 because the install ID doesn't exist, but not 400.
    expect(res.statusCode).not.toBe(400);
  });
});
