import type { FastifyRequest } from 'fastify';
import type { AuthzClient } from '@urule/authz';

/**
 * Options for the `authzMiddleware` Fastify plugin. The caller passes an
 * `AuthzClient` (either a real `createAuthzClient(...)` or `createMockAuthzClient()`
 * for tests) and the plugin decorates `request.authz` with it.
 */
export interface AuthzMiddlewareOptions {
  authzClient: AuthzClient;
}

/**
 * Resolves the workspace id to authorize against, from a request. Sync or async.
 * Return `null` to short-circuit with a 404 (the resource doesn't exist or the
 * caller didn't supply a workspace id).
 */
export type WorkspaceIdResolver = (
  request: FastifyRequest,
) => string | null | Promise<string | null>;

/**
 * Knobs for the `requireMembership` preHandler.
 */
export interface RequireMembershipOptions {
  /**
   * OpenFGA relation to require on the resolved workspace (defaults to `member`).
   * The URULE_AUTH_MODEL's `member` relation is inclusive — it matches direct
   * members, admins, owners, and parent-org members. Use `admin` for stricter
   * gates (e.g., destructive operations).
   */
  relation?: string;
  /**
   * Object type prefix the workspace id is namespaced under (defaults to `workspace`).
   * Most route guards check `workspace:<id>`; some org-scoped routes may want
   * `org` instead.
   */
  objectType?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The `AuthzClient` registered by `authzMiddleware`. Use `request.authz.check(user, relation, object)`
     * for inline authorization in route handlers; the `requireMembership` /
     * `requireRole` preHandlers wrap the same call.
     */
    authz: AuthzClient;
  }
}
