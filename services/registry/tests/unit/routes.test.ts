import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { authMiddleware } from '@urule/auth-middleware';
import { registerAuthRoutes } from '../../src/routes/auth.routes.js';

// We test auth routes and validation since they don't need a DB

describe('registry routes', () => {
  async function buildTestApp() {
    const app = Fastify({ logger: false });
    await app.register(cors, { origin: true });
    await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
    await app.register(authMiddleware, { skipAuth: true });
    app.get('/healthz', async () => ({ status: 'ok' }));
    registerAuthRoutes(app);
    return app;
  }

  describe('GET /healthz', () => {
    it('should return 200 with ok status', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
    });
  });

  describe('POST /auth/login', () => {
    it('should return 400 if email is missing', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST', url: '/auth/login',
        payload: { password: 'test' },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('Validation failed');
    });

    it('should return 400 if email is invalid format', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST', url: '/auth/login',
        payload: { email: 'not-an-email', password: 'test' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 if password is empty', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST', url: '/auth/login',
        payload: { email: 'test@example.com', password: '' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 502 when Keycloak is unreachable', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST', url: '/auth/login',
        payload: { email: 'test@example.com', password: 'password123' },
      });
      // Keycloak is not running in test, so should get 502
      expect(res.statusCode).toBe(502);
    });
  });

  describe('GET /auth/me', () => {
    it('should return mock user in skipAuth mode', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/auth/me' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBeDefined();
      expect(body.username).toBeDefined();
      expect(body.email).toBeDefined();
    });
  });
});
