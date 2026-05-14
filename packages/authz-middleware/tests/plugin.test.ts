import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createMockAuthzClient } from '@urule/authz/testing';
import { authzMiddleware } from '../src/plugin.js';

describe('@urule/authz-middleware — plugin', () => {
  it('decorates request.authz with the configured AuthzClient', async () => {
    const app = Fastify({ logger: false });
    const authzClient = createMockAuthzClient();
    await app.register(authzMiddleware, { authzClient });

    let captured: unknown = null;
    app.get('/probe', async (request) => {
      captured = request.authz;
      return { ok: true };
    });

    const res = await app.inject({ method: 'GET', url: '/probe' });
    expect(res.statusCode).toBe(200);
    // The client we passed in is the same instance the handler sees.
    expect(captured).toBe(authzClient);
  });

  it('throws if authzClient is omitted', async () => {
    const app = Fastify({ logger: false });
    await expect(
      // @ts-expect-error — intentionally omitting the required option
      app.register(authzMiddleware, {}),
    ).rejects.toThrow(/authzClient/);
  });

  it('routes can call request.authz.check directly', async () => {
    const app = Fastify({ logger: false });
    const authzClient = createMockAuthzClient();
    await authzClient.writeTuples([
      { user: 'user:alice', relation: 'member', object: 'workspace:ws-1' },
    ]);
    await app.register(authzMiddleware, { authzClient });

    app.get('/check', async (request) => {
      const result = await request.authz.check('user:alice', 'member', 'workspace:ws-1');
      return result;
    });

    const res = await app.inject({ method: 'GET', url: '/check' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ allowed: true });
  });
});
