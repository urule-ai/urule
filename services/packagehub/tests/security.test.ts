import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { validateConfig, loadConfig } from '../src/config.js';

describe('packagehub — config validation', () => {
  it('throws when DATABASE_URL is missing', () => {
    const original = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    try {
      const cfg = loadConfig();
      expect(() => validateConfig(cfg)).toThrowError(/DATABASE_URL/);
    } finally {
      if (original !== undefined) process.env['DATABASE_URL'] = original;
    }
  });

  it('throws when NATS_URL is missing', () => {
    const origDb = process.env['DATABASE_URL'];
    const origNats = process.env['NATS_URL'];
    process.env['DATABASE_URL'] = 'postgres://example.host:5432/test';
    delete process.env['NATS_URL'];
    try {
      const cfg = loadConfig();
      expect(() => validateConfig(cfg)).toThrowError(/NATS_URL/);
    } finally {
      if (origDb !== undefined) process.env['DATABASE_URL'] = origDb;
      else delete process.env['DATABASE_URL'];
      if (origNats !== undefined) process.env['NATS_URL'] = origNats;
    }
  });

  it('does not throw when both DATABASE_URL and NATS_URL are set', () => {
    const origDb = process.env['DATABASE_URL'];
    const origNats = process.env['NATS_URL'];
    process.env['DATABASE_URL'] = 'postgres://example.host:5432/test';
    process.env['NATS_URL'] = 'nats://example.host:4222';
    try {
      const cfg = loadConfig();
      expect(() => validateConfig(cfg)).not.toThrow();
    } finally {
      if (origDb !== undefined) process.env['DATABASE_URL'] = origDb;
      else delete process.env['DATABASE_URL'];
      if (origNats !== undefined) process.env['NATS_URL'] = origNats;
      else delete process.env['NATS_URL'];
    }
  });
});

describe('packagehub — CORS lockdown', () => {
  async function buildCorsApp() {
    const app = Fastify({ logger: false });
    await app.register(cors, { origin: ['http://localhost:3000'] });
    app.get('/healthz', async () => ({ status: 'ok' }));
    return app;
  }

  it('echoes Access-Control-Allow-Origin for an allow-listed origin', async () => {
    const app = await buildCorsApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/healthz',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('does not echo Access-Control-Allow-Origin for a non-allow-listed origin', async () => {
    const app = await buildCorsApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/healthz',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
