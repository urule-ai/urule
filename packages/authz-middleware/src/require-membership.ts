import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { RequireMembershipOptions, WorkspaceIdResolver } from './types.js';

interface MaybeUser {
  id?: string;
}

/**
 * `requireMembership(getWorkspaceId, opts?)` — Fastify preHandler factory that
 * gates a route on workspace (or org) membership.
 *
 * Flow:
 *   1. Read `request.uruleUser.id` (the authenticated subject). 401 if absent.
 *   2. Call `getWorkspaceId(request)` to resolve the target workspace.
 *      Returning `null` means "resource not found / no workspace id supplied"
 *      → 404; the route handler doesn't run.
 *   3. Call `request.authz.check('user:<id>', <relation>, '<objectType>:<wsId>')`
 *      (defaults: relation `'member'`, objectType `'workspace'`). 403 on deny.
 *
 * The membership model lives in OpenFGA (URULE_AUTH_MODEL); `member` is the
 * inclusive relation (members ∪ admins ∪ owners ∪ org-members-via-parent).
 *
 * Register `@urule/authz-middleware` first so `request.authz` is available.
 */
export function requireMembership(
  getWorkspaceId: WorkspaceIdResolver,
  opts: RequireMembershipOptions = {},
): preHandlerHookHandler {
  const relation = opts.relation ?? 'member';
  const objectType = opts.objectType ?? 'workspace';

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = (request as FastifyRequest & { uruleUser?: MaybeUser }).uruleUser;
    if (!user?.id) {
      reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const workspaceId = await getWorkspaceId(request);
    if (workspaceId === null) {
      reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
      return;
    }

    const { allowed } = await request.authz.check(
      `user:${user.id}`,
      relation,
      `${objectType}:${workspaceId}`,
    );
    if (!allowed) {
      reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Not authorized for ${objectType}:${workspaceId} (requires ${relation})`,
        },
      });
    }
  };
}
