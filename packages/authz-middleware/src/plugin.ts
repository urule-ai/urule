import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthzClient } from '@urule/authz';
import type { AuthzMiddlewareOptions } from './types.js';

/**
 * Urule Authz Middleware — Fastify plugin that decorates every request with an
 * `AuthzClient` (`request.authz`). The plugin itself enforces nothing; route
 * handlers (or the `requireMembership` / `requireRole` preHandler factories)
 * read `request.authz` and call `.check(user, relation, object)` to gate.
 *
 * Register **after** `@urule/auth-middleware` so `request.uruleUser` is already
 * decorated by the time authz checks fire.
 *
 *     await app.register(authMiddleware, { /* … *\/ });
 *     await app.register(authzMiddleware, { authzClient });
 */
async function uruleAuthzPlugin(app: FastifyInstance, opts: AuthzMiddlewareOptions) {
  if (!opts.authzClient) {
    throw new Error('authzMiddleware: `authzClient` option is required');
  }
  app.decorateRequest('authz', null as unknown as AuthzClient);
  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.authz = opts.authzClient;
  });
}

export const authzMiddleware = fp(uruleAuthzPlugin, {
  name: '@urule/authz-middleware',
  fastify: '5.x',
});
