import type { FastifyRequest } from 'fastify';
import type { WorkspaceIdResolver } from '@urule/authz-middleware';
import type { InstallationRepo } from './services/installation-repo.js';

/* ------------------------------------------------------------------ *
 * Workspace-id resolvers for `requireMembership` preHandlers.
 *
 * Each resolver mirrors how its route identifies the target workspace,
 * so the membership check and the handler never disagree. A resolver
 * returns `null` to make `requireMembership` answer 404 (unknown
 * resource) without leaking existence.
 *
 * The OpenFGA client is built by `bootstrapAuthzClient` from `@urule/authz`
 * — see server.ts.
 * ------------------------------------------------------------------ */

/** Resolver for `/workspaces/:wsId/...` routes — the workspace id is in the path. */
export const wsParamResolver: WorkspaceIdResolver = (req: FastifyRequest) => {
  const { wsId } = req.params as { wsId?: string };
  return wsId ?? null;
};

/** Resolver for `POST /packages/install` — the workspace id is in the body. */
export const bodyWorkspaceResolver: WorkspaceIdResolver = (req: FastifyRequest) => {
  const body = (req.body ?? {}) as { workspaceId?: string };
  return body.workspaceId ?? null;
};

/**
 * Resolver for `/packages/:installId` routes — looks the installation up and
 * returns its workspace. An unknown install id resolves to `null` → 404.
 */
export function installationWorkspaceResolver(repo: InstallationRepo): WorkspaceIdResolver {
  return async (req: FastifyRequest) => {
    const { installId } = req.params as { installId?: string };
    if (!installId) return null;
    const record = await repo.getById(installId);
    return record?.workspaceId ?? null;
  };
}
