import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { authMiddleware, audienceMatches } from '../src/plugin.js';
import type { UruleUser } from '../src/types.js';

describe('urule-auth-middleware', () => {
  describe('skipAuth mode', () => {
    it('should inject mock user when skipAuth is true', async () => {
      const app = Fastify();
      await app.register(authMiddleware, { skipAuth: true });

      let capturedUser: UruleUser | null = null;

      app.get('/api/v1/test', async (request) => {
        capturedUser = (request as unknown as { uruleUser: UruleUser }).uruleUser;
        return { ok: true };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/test',
      });

      expect(response.statusCode).toBe(200);
      expect(capturedUser).not.toBeNull();
      expect(capturedUser!.id).toBe('dev-user-001');
      expect(capturedUser!.username).toBe('dev');
      expect(capturedUser!.roles).toContain('admin');
    });

    it('should not require Authorization header when skipAuth is true', async () => {
      const app = Fastify();
      await app.register(authMiddleware, { skipAuth: true });

      app.get('/api/v1/protected', async () => ({ ok: true }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/protected',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('public routes', () => {
    it('should allow /healthz without auth even in skipAuth=false mode', async () => {
      const app = Fastify({ logger: false });
      // skipAuth false + JWKS unreachable → fails closed, but /healthz is public
      await app.register(authMiddleware, {
        skipAuth: false,
        jwksUrl: 'http://localhost:99999/nonexistent',
      });

      app.get('/healthz', async () => ({ status: 'ok' }));

      const response = await app.inject({
        method: 'GET',
        url: '/healthz',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should allow custom public routes', async () => {
      const app = Fastify();
      await app.register(authMiddleware, {
        skipAuth: true,
        publicRoutes: ['/api/v1/webhook'],
      });

      app.get('/api/v1/webhook', async () => ({ received: true }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/webhook',
      });

      expect(response.statusCode).toBe(200);
    });

    it('honours method-qualified public routes (GET public, POST authenticated)', async () => {
      // skipAuth:false + unreachable JWKS → fails closed; only public routes pass.
      const app = Fastify({ logger: false });
      await app.register(authMiddleware, {
        skipAuth: false,
        jwksUrl: 'http://localhost:99999/nonexistent',
        publicRoutes: ['GET /api/v1/packages'],
      });
      app.get('/api/v1/packages', async () => ({ ok: true }));
      app.get('/api/v1/packages/some-pkg', async () => ({ ok: true }));
      app.post('/api/v1/packages', async () => ({ ok: true }));

      // GET (and sub-paths) are public.
      expect((await app.inject({ method: 'GET', url: '/api/v1/packages' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/v1/packages/some-pkg' })).statusCode).toBe(200);
      // POST to the same path still authenticates → 401 (fail-closed).
      expect((await app.inject({ method: 'POST', url: '/api/v1/packages', payload: {} })).statusCode).toBe(401);
    });
  });

  describe('user extraction', () => {
    it('should expose uruleUser on all requests in skipAuth mode', async () => {
      const app = Fastify();
      await app.register(authMiddleware, { skipAuth: true });

      app.get('/api/v1/me', async (request) => {
        const user = (request as unknown as { uruleUser: UruleUser }).uruleUser;
        return { user };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
      });

      const body = JSON.parse(response.body);
      expect(body.user).toEqual({
        id: 'dev-user-001',
        username: 'dev',
        email: 'dev@urule.local',
        name: 'Dev User',
        roles: ['admin'],
      });
    });
  });

  describe('fail-closed (JWKS unreachable, no skipAuth)', () => {
    it('returns 401 on protected routes when JWKS is unreachable', async () => {
      const app = Fastify({ logger: false });
      await app.register(authMiddleware, {
        jwksUrl: 'http://localhost:99999/nonexistent',
      });
      app.get('/api/v1/protected', async () => ({ ok: true }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/protected' });
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error).toBe('Unauthorized');
    });

    it('does NOT run the route handler (never authenticates as the mock admin)', async () => {
      const app = Fastify({ logger: false });
      await app.register(authMiddleware, {
        jwksUrl: 'http://localhost:99999/nonexistent',
      });

      let handlerRan = false;
      app.get('/api/v1/protected', async () => {
        handlerRan = true;
        return { ok: true };
      });

      const response = await app.inject({ method: 'GET', url: '/api/v1/protected' });
      expect(response.statusCode).toBe(401);
      expect(handlerRan).toBe(false);
    });

    it('still allows /healthz when JWKS is unreachable (so liveness probes pass)', async () => {
      const app = Fastify({ logger: false });
      await app.register(authMiddleware, {
        jwksUrl: 'http://localhost:99999/nonexistent',
      });
      app.get('/healthz', async () => ({ status: 'ok' }));

      const response = await app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(200);
    });

    it('still allows custom public routes when JWKS is unreachable', async () => {
      const app = Fastify({ logger: false });
      await app.register(authMiddleware, {
        jwksUrl: 'http://localhost:99999/nonexistent',
        publicRoutes: ['/api/v1/webhooks'],
      });
      app.post('/api/v1/webhooks/slack', async () => ({ received: true }));

      const response = await app.inject({ method: 'POST', url: '/api/v1/webhooks/slack' });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('audience validation', () => {
    it('accepts a token whose aud includes the configured audience', () => {
      expect(audienceMatches('urule-office', 'urule-office')).toBe(true);
      expect(audienceMatches(['urule-office'], 'urule-office')).toBe(true);
      expect(audienceMatches(['account', 'urule-office'], 'urule-office')).toBe(true);
    });

    it('rejects a token whose aud is only Keycloak\'s built-in "account"', () => {
      expect(audienceMatches('account', 'urule-office')).toBe(false);
      expect(audienceMatches(['account'], 'urule-office')).toBe(false);
    });

    it('accepts a token with no aud claim (Keycloak omits it for some token types)', () => {
      expect(audienceMatches(undefined, 'urule-office')).toBe(true);
    });
  });
});
