import type { FastifyInstance } from 'fastify';
import type { PackageManager } from '../services/package-manager.js';
import type { EventBus } from '@urule/events';
import { PACKAGE_TOPICS } from '@urule/events';

export interface InstallationRoutesOptions {
  /** Optional event bus — when set, /updates emits UPDATE_AVAILABLE per outdated installation. */
  eventBus?: EventBus;
}

export function registerInstallationRoutes(
  app: FastifyInstance,
  manager: PackageManager,
  options: InstallationRoutesOptions = {},
): void {
  app.get<{
    Params: { wsId: string };
  }>('/api/v1/workspaces/:wsId/packages', {
    schema: {
      tags: ['installations'],
      summary: 'List installations in a workspace',
      description:
        'Returns every package installed in the workspace with its current version, type, status, and config. Status is one of `pending | installing | installed | failed | removing` — UI typically filters to `installed`.',
    },
  }, async (request) => {
    const { wsId } = request.params;
    const packages = await manager.list(wsId);
    return { packages };
  });

  /**
   * GET /api/v1/workspaces/:wsId/updates
   * Diffs every installation's version against the latest non-yanked
   * version published in packagehub. Returns the list of outdated
   * installations and emits one UPDATE_AVAILABLE NATS event per entry
   * so office-ui's notification center surfaces them via §3.5.
   */
  app.get<{
    Params: { wsId: string };
  }>('/api/v1/workspaces/:wsId/updates', {
    schema: {
      tags: ['installations'],
      summary: 'Check for available updates',
      description:
        "Diffs each installation's version against the latest non-yanked version in packagehub. Returns `{ workspaceId, updates: [{ installationId, packageName, installedVersion, latestVersion }], count }`. Side effect: publishes one `urule.packages.update.available` NATS event per outdated row so office-ui's notification center can surface a real-time toast.",
    },
  }, async (request) => {
    const { wsId } = request.params;
    const updates = await manager.checkUpdates(wsId);

    if (options.eventBus) {
      // Fire-and-forget — don't block the HTTP response on NATS publish.
      // Per-update event so consumers can deep-link to a specific
      // installation's upgrade flow.
      for (const u of updates) {
        options.eventBus.publish(PACKAGE_TOPICS.UPDATE_AVAILABLE, {
          workspaceId: wsId,
          installationId: u.installationId,
          packageName: u.packageName,
          installedVersion: u.installedVersion,
          latestVersion: u.latestVersion,
        }).catch((err: unknown) => {
          request.log.warn({ err, packageName: u.packageName }, 'Failed to publish UPDATE_AVAILABLE');
        });
      }
    }

    return { workspaceId: wsId, updates, count: updates.length };
  });

  app.get<{
    Params: { installId: string };
  }>('/api/v1/packages/:installId', {
    schema: {
      tags: ['installations'],
      summary: 'Get installation status by id',
      description:
        'Returns the installation row for the given install id (the ULID returned from `/install`). Useful for polling status while a long-running install / upgrade is in flight. 404 when the installation is unknown.',
    },
  }, async (request, reply) => {
    const { installId } = request.params;
    try {
      const installation = await manager.getStatus(installId);
      return installation;
    } catch {
      return reply.status(404).send({ error: 'Installation not found' });
    }
  });
}
