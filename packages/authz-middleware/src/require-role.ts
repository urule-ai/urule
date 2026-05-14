import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

interface MaybeUser {
  roles?: string[];
}

/**
 * `requireRole(role)` — Fastify preHandler factory that gates a route on a JWT
 * realm-role claim (e.g., `admin`). It does NOT consult OpenFGA — for
 * resource-level authz, use `requireMembership` instead.
 *
 * Replaces the inline `request.uruleUser.roles.includes('admin')` checks the
 * registry routes were doing for cross-workspace endpoints (see PRs #93, #96).
 * Use this for routes that are genuinely admin-only (cross-workspace lists,
 * platform-config operations); use `requireMembership` for routes scoped to a
 * single workspace.
 */
export function requireRole(role: string): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = (request as FastifyRequest & { uruleUser?: MaybeUser }).uruleUser;
    if (!user?.roles?.includes(role)) {
      reply.code(403).send({
        error: { code: 'FORBIDDEN', message: `${role} role required` },
      });
    }
  };
}
