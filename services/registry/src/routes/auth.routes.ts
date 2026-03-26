import type { FastifyInstance } from 'fastify';
import type { UruleUser } from '@urule/auth-middleware';

/**
 * Auth routes — bridge between the Office UI and Keycloak.
 *
 * POST /auth/login  — Exchange email+password for Keycloak tokens
 * GET  /auth/me     — Return the current user from the JWT
 */
export function registerAuthRoutes(app: FastifyInstance) {
  const keycloakUrl = process.env['KEYCLOAK_URL'] ?? 'http://localhost:8281';
  const realm = process.env['KEYCLOAK_REALM'] ?? 'urule';
  const clientId = process.env['KEYCLOAK_CLIENT_ID'] ?? 'urule-office';

  /**
   * POST /auth/login
   * Exchanges username+password for Keycloak OIDC tokens.
   */
  app.post<{
    Body: { email: string; password: string };
  }>('/auth/login', async (request, reply) => {
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.code(400).send({ error: 'Email and password are required' });
    }

    try {
      const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: clientId,
          username: email,
          password,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error_description?: string };
        return reply.code(401).send({
          error: 'Authentication failed',
          detail: error.error_description ?? 'Invalid credentials',
        });
      }

      const tokens = await response.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
      };

      return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        token_type: tokens.token_type,
      };
    } catch {
      return reply.code(502).send({
        error: 'Authentication service unavailable',
        detail: 'Could not reach Keycloak',
      });
    }
  });

  /**
   * GET /auth/me
   * Returns the current user identity from the JWT token.
   * Requires a valid Bearer token.
   */
  app.get('/auth/me', async (request) => {
    const user = (request as unknown as { uruleUser: UruleUser }).uruleUser;
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      roles: user.roles,
    };
  });
}
