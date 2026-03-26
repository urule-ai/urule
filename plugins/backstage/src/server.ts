import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { authMiddleware } from '@urule/auth-middleware';
import { CatalogSyncService, type RegistryClient } from './catalog/sync-service.js';
import type { UruleOrg, UruleWorkspace, UruleAgent } from './catalog/entity-mapper.js';
import { getUruleScaffolderActions } from './scaffolder/actions.js';
import { catalogRoutes } from './routes/catalog.routes.js';
import type { Config } from './config.js';

function createRegistryClient(registryUrl: string): RegistryClient {
  return {
    async fetchOrgs() {
      const res = await fetch(`${registryUrl}/api/v1/orgs`);
      if (!res.ok) throw new Error(`Registry error: ${res.status}`);
      return res.json() as Promise<UruleOrg[]>;
    },
    async fetchWorkspaces(orgId: string) {
      const res = await fetch(`${registryUrl}/api/v1/orgs/${orgId}/workspaces`);
      if (!res.ok) throw new Error(`Registry error: ${res.status}`);
      return res.json() as Promise<UruleWorkspace[]>;
    },
    async fetchAgents(workspaceId: string) {
      const res = await fetch(`${registryUrl}/api/v1/workspaces/${workspaceId}/agents`);
      if (!res.ok) throw new Error(`Registry error: ${res.status}`);
      return res.json() as Promise<UruleAgent[]>;
    },
  };
}

export async function buildServer(config: Config) {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            hostname: request.hostname,
            remoteAddress: request.ip,
          };
        },
      },
    },
    genReqId: () => crypto.randomUUID(),
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Auth middleware
  await app.register(authMiddleware, { publicRoutes: ['/healthz'] });

  // Health check
  app.get('/healthz', async () => ({ status: 'ok', service: config.serviceName }));

  // Services
  const registryClient = createRegistryClient(config.registryUrl);
  const syncService = new CatalogSyncService(registryClient);
  const scaffolderActions = getUruleScaffolderActions();

  // Routes
  await app.register(catalogRoutes, { syncService, scaffolderActions });

  return app;
}
