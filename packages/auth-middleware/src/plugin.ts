import fp from 'fastify-plugin';
import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthMiddlewareOptions, UruleJwtPayload, UruleUser } from './types.js';

/** Default mock user for development when skipAuth is true. */
const MOCK_USER: UruleUser = {
  id: 'dev-user-001',
  username: 'dev',
  email: 'dev@urule.local',
  name: 'Dev User',
  roles: ['admin'],
};

/** Default routes that never require auth. */
const DEFAULT_PUBLIC_ROUTES = ['/healthz'];

/**
 * Extract a UruleUser from a decoded JWT payload.
 */
function toUruleUser(payload: UruleJwtPayload): UruleUser {
  return {
    id: payload.sub,
    username: payload.preferred_username ?? payload.email ?? payload.sub,
    email: payload.email ?? '',
    name: payload.name ?? payload.preferred_username ?? 'Unknown',
    roles: payload.realm_access?.roles ?? [],
  };
}

/**
 * Fetch the JWKS (JSON Web Key Set) from Keycloak and extract the first RSA public key.
 */
async function fetchJwksPublicKey(jwksUrl: string): Promise<string> {
  const response = await fetch(jwksUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS from ${jwksUrl}: ${response.status}`);
  }
  const jwks = await response.json() as { keys: Array<{ kty: string; x5c?: string[]; use?: string }> };
  const signingKey = jwks.keys.find(k => k.use === 'sig' && k.kty === 'RSA');
  if (!signingKey?.x5c?.[0]) {
    throw new Error('No RSA signing key found in JWKS');
  }
  const cert = signingKey.x5c[0];
  return `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
}

/**
 * Urule Auth Middleware — Fastify plugin that validates Keycloak JWTs.
 *
 * When registered, this plugin:
 * 1. Fetches the Keycloak public key via JWKS
 * 2. Registers @fastify/jwt with the public key
 * 3. Adds an onRequest hook that validates Bearer tokens
 * 4. Decorates requests with `request.uruleUser` (UruleUser)
 *
 * Public routes (healthz, webhooks, etc.) skip validation.
 */
async function uruleAuthPlugin(app: FastifyInstance, opts: AuthMiddlewareOptions) {
  const keycloakUrl = opts.issuer ?? process.env['KEYCLOAK_REALM_URL'] ?? 'http://localhost:8281/realms/urule';
  const jwksUrl = opts.jwksUrl ?? `${keycloakUrl}/protocol/openid-connect/certs`;
  const audience = opts.audience ?? 'urule-office';
  const skipAuth = opts.skipAuth ?? (process.env['SKIP_AUTH'] === 'true');
  const failClosed = opts.failClosed ?? (process.env['AUTH_FAIL_CLOSED'] === 'true');
  const publicRoutes = [...DEFAULT_PUBLIC_ROUTES, ...(opts.publicRoutes ?? [])];

  function isPublicRoute(url: string): boolean {
    const path = url.split('?')[0] ?? '';
    return publicRoutes.some((route) => path === route || path.startsWith(route + '/'));
  }

  // Decorate requests with uruleUser
  app.decorateRequest('uruleUser', null);

  if (skipAuth) {
    app.log.warn('Auth middleware: SKIP_AUTH=true — all requests will use mock user identity');
    app.addHook('onRequest', async (request: FastifyRequest) => {
      (request as FastifyRequest & { uruleUser: UruleUser }).uruleUser = MOCK_USER;
    });
    return;
  }

  // Fetch JWKS public key
  let publicKey: string;
  try {
    publicKey = await fetchJwksPublicKey(jwksUrl);
    app.log.info(`Auth middleware: loaded public key from ${jwksUrl}`);
  } catch (err) {
    if (failClosed) {
      app.log.error(
        `Auth middleware: failClosed=true and JWKS fetch from ${jwksUrl} failed (${err}); all non-public requests will return 401`,
      );
      app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        if (isPublicRoute(request.url)) return;
        reply.code(401).send({ error: 'Unauthorized', message: 'Auth not available' });
      });
      return;
    }
    app.log.warn(`Auth middleware: could not fetch JWKS from ${jwksUrl}, falling back to SKIP_AUTH mode. Error: ${err}`);
    app.addHook('onRequest', async (request: FastifyRequest) => {
      (request as FastifyRequest & { uruleUser: UruleUser }).uruleUser = MOCK_USER;
    });
    return;
  }

  // Register @fastify/jwt with the public key
  await app.register(fjwt, {
    secret: {
      public: publicKey,
      private: '', // We only verify, never sign
    },
    verify: {
      algorithms: ['RS256'],
    },
  });

  // Auth hook — validate JWT on every request except public routes
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for public routes
    if (isPublicRoute(request.url)) {
      return;
    }

    try {
      const decoded = await request.jwtVerify<UruleJwtPayload>();

      // Validate issuer
      if (decoded.iss && decoded.iss !== keycloakUrl) {
        reply.code(401).send({ error: 'Invalid token issuer' });
        return;
      }

      // Validate audience
      if (decoded.aud) {
        const audiences = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
        if (!audiences.includes(audience) && !audiences.includes('account')) {
          reply.code(401).send({ error: 'Invalid token audience' });
          return;
        }
      }

      (request as FastifyRequest & { uruleUser: UruleUser }).uruleUser = toUruleUser(decoded);
    } catch {
      reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
    }
  });
}

export const authMiddleware = fp(uruleAuthPlugin, {
  name: '@urule/auth-middleware',
  fastify: '5.x',
});
