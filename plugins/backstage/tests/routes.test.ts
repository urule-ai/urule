import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';

describe('Backstage Plugin Routes', () => {
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
    expect(body.service).toBe('backstage-urule-plugin');
  });

  it('GET /api/v1/catalog/entities returns array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/catalog/entities',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/v1/scaffolder/actions returns array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/scaffolder/actions',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
