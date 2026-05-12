import fp from 'fastify-plugin';
import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthMiddlewareOptions, UruleJwtPayload, UruleUser } from './types.js';

/**
 * Mock user injected ONLY when `SKIP_AUTH=true`. It has the `admin` role, so
 * `SKIP_AUTH` must never be enabled in a real deployment.
 */
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
 * Whether a token's `aud` claim is acceptable for this service.
 *
 * A token with no `aud` claim passes (Keycloak omits it for some token types).
 * When present, it must include the configured `expected` audience — there is
 * deliberately no implicit acceptance of Keycloak's built-in `account`
 * audience; configure the client with an audience mapper instead.
 */
export function audienceMatches(aud: UruleJwtPayload['aud'], expected: string): boolean {
  if (aud === undefined || aud === null) return true;
  return (Array.isArray(aud) ? aud : [aud]).includes(expected);
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
 * Public routes (healthz, webhooks, etc.) skip validation. If the JWKS endpoint
 * is unreachable at startup the plugin **fails closed** — every non-public
 * request returns 401 (it never falls back to authenticating requests as the
 * mock admin). The only way to skip JWT validation is the explicit
 * `SKIP_AUTH=true` development escape hatch.
 */
async function uruleAuthPlugin(app: FastifyInstance, opts: AuthMiddlewareOptions) {
  const keycloakUrl = opts.issuer ?? process.env['KEYCLOAK_REALM_URL'] ?? 'http://localhost:8281/realms/urule';
  const jwksUrl = opts.jwksUrl ?? `${keycloakUrl}/protocol/openid-connect/certs`;
  const audience = opts.audience ?? 'urule-office';
  const skipAuth = opts.skipAuth ?? (process.env['SKIP_AUTH'] === 'true');
  const publicRoutes = [...DEFAULT_PUBLIC_ROUTES, ...(opts.publicRoutes ?? [])];

  function isPublicRoute(url: string): boolean {
    const path = url.split('?')[0] ?? '';
    return publicRoutes.some((route) => path === route || path.startsWith(route + '/'));
  }

  // Decorate requests with uruleUser
  app.decorateRequest('uruleUser', null);

  // Development escape hatch — must be set explicitly. Every request runs as the
  // admin MOCK_USER, so this must never be enabled in a real deployment.
  if (skipAuth) {
    app.log.warn('Auth middleware: SKIP_AUTH=true — all requests run as the mock admin user. Development only; never enable in production.');
    app.addHook('onRequest', async (request: FastifyRequest) => {
      (request as FastifyRequest & { uruleUser: UruleUser }).uruleUser = MOCK_USER;
    });
    return;
  }

  // Fetch the JWKS public key. If this fails we FAIL CLOSED — every non-public
  // request gets a 401 — rather than silently authenticating everyone as the
  // mock admin. /healthz and any other publicRoutes still respond so k8s
  // liveness/readiness probes keep working while auth recovers.
  let publicKey: string;
  try {
    publicKey = await fetchJwksPublicKey(jwksUrl);
    app.log.info(`Auth middleware: loaded public key from ${jwksUrl}`);
  } catch (err) {
    app.log.error(
      `Auth middleware: JWKS fetch from ${jwksUrl} failed (${err}); failing closed — all non-public requests will return 401`,
    );
    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      if (isPublicRoute(request.url)) return;
      reply.code(401).send({ error: 'Unauthorized', message: 'Authentication is not available' });
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
      if (!audienceMatches(decoded.aud, audience)) {
        reply.code(401).send({ error: 'Invalid token audience' });
        return;
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
