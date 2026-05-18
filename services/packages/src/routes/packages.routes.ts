import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireMembership } from '@urule/authz-middleware';
import { EntitlementRequiredError } from '../services/package-manager.js';
import type { PackageManager } from '../services/package-manager.js';
import type { InstallationRepo } from '../services/installation-repo.js';
import { bodyWorkspaceResolver, installationWorkspaceResolver } from '../authz.js';
import type { PackageInstallRequest } from '../types.js';

const installPackageSchema = z.object({
  workspaceId: z.string(),
  packageName: z.string().min(1),
  version: z.string().optional(),
  source: z.object({}).loose().optional(),
});

const upgradePackageSchema = z.object({
  version: z.string().optional(),
});

const installIdParamsSchema = z.object({
  installId: z.string(),
});

export function registerPackageRoutes(
  app: FastifyInstance,
  manager: PackageManager,
  repo: InstallationRepo,
): void {
  // Install gates on the body's workspace; upgrade/rollback/remove resolve the
  // installation to its workspace first (unknown install id → 404).
  const requireBodyMembership = requireMembership(bodyWorkspaceResolver);
  const requireInstallationMembership = requireMembership(installationWorkspaceResolver(repo));

  app.post<{
    Body: PackageInstallRequest;
  }>('/api/v1/packages/install', {
    preHandler: requireBodyMembership,
    schema: {
      tags: ['packages'],
      summary: 'Install a package into a workspace',
      description:
        'Resolves the manifest from packagehub (or a GitHub URL / local path via `source`), runs the dependency resolver against currently-installed packages, and creates an installation row. Consults packagehub\'s entitlement endpoint first — paid / subscription packages 402 ENTITLEMENT_REQUIRED with a `paymentLink` in the body if the workspace has no row. 409 on dependency conflicts.',
      body: installPackageSchema,
    },
  }, async (request, reply) => {
    try {
      const installation = await manager.install(request.body);
      return reply.status(201).send(installation);
    } catch (err) {
      if (err instanceof EntitlementRequiredError) {
        return reply.status(402).send({
          error: { code: 'ENTITLEMENT_REQUIRED', message: err.message },
          ...err.details,
        });
      }
      const message = err instanceof Error ? err.message : 'Install failed';
      return reply.status(409).send({ error: message });
    }
  });

  // Rollback to the immediately-previous installed version of this package.
  app.post<{ Params: { installId: string } }>(
    '/api/v1/packages/:installId/rollback',
    {
      preHandler: requireInstallationMembership,
      schema: {
        tags: ['packages'],
        summary: 'Roll back to the previous version',
        description:
          "Walks the version-history stack, pops the top entry, and reverts the installation to the prior version. Each `install` and `upgrade` pushes a new history row; rollback can be called repeatedly until the stack is exhausted. 404 NO_HISTORY when the install has only one history row (you can't roll back past the initial install). Survives service restart — history persists in postgres.",
        params: installIdParamsSchema,
      },
    },
    async (request, reply) => {
      const { installId } = request.params;
      try {
        const installation = await manager.rollback(installId);
        return installation;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Rollback failed';
        const code = (err as Error & { code?: string }).code;
        if (code === 'NO_HISTORY' || message.includes('not found')) {
          return reply.status(404).send({
            error: { code: code ?? 'NOT_FOUND', message },
          });
        }
        return reply.status(409).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { installId: string };
    Body: { version?: string };
  }>('/api/v1/packages/:installId/upgrade', {
    preHandler: requireInstallationMembership,
    schema: {
      tags: ['packages'],
      summary: 'Upgrade an installation to a newer version',
      description:
        "Body `{ version? }` — when omitted, upgrades to packagehub's latest non-yanked version. Re-runs the dependency resolver against the new manifest. The previous version is pushed onto the history stack so subsequent `/rollback` calls reverse the upgrade. 409 on dependency conflicts; the installation is reverted to its pre-upgrade state on conflict.",
      params: installIdParamsSchema,
      body: upgradePackageSchema,
    },
  }, async (request, reply) => {
    const { installId } = request.params;
    const { version } = request.body ?? {};

    try {
      const installation = await manager.upgrade(installId, version);
      return installation;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upgrade failed';
      if (message.includes('not found')) {
        return reply.status(404).send({ error: message });
      }
      return reply.status(409).send({ error: message });
    }
  });

  app.delete<{
    Params: { installId: string };
  }>('/api/v1/packages/:installId', {
    preHandler: requireInstallationMembership,
    schema: {
      tags: ['packages'],
      summary: 'Uninstall a package from a workspace',
      description:
        'Hard-removes the installation + cascades the version-history rows. 204 on success, 404 when the installation id is unknown. Does NOT consult packagehub or revoke entitlements — uninstalling a paid package leaves the workspace\'s entitlement intact for a future re-install.',
      params: installIdParamsSchema,
    },
  }, async (request, reply) => {
    const { installId } = request.params;

    try {
      await manager.remove(installId);
      return reply.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Remove failed';
      return reply.status(404).send({ error: message });
    }
  });
}
