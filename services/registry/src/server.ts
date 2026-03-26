import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authMiddleware } from '@urule/auth-middleware';
import { createDb } from './db/connection.js';
import { registerOrgRoutes } from './routes/orgs.routes.js';
import { registerWorkspaceRoutes } from './routes/workspaces.routes.js';
import { registerAgentRoutes } from './routes/agents.routes.js';
import { registerRuntimeRoutes } from './routes/runtimes.routes.js';
import { registerProviderRoutes } from './routes/providers.routes.js';
import { registerConversationRoutes } from './routes/conversations.routes.js';
import { registerIntegrationRoutes } from './routes/integrations.routes.js';
import { registerLogRoutes } from './routes/logs.routes.js';
import { registerStatsRoutes } from './routes/stats.routes.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { errorHandler } from './middleware/error-handler.js';
import type { Config } from './config.js';

export async function buildServer(config: Config) {
  const app = Fastify({
    logger: true,
    genReqId: () => crypto.randomUUID(),
  });

  // CORS — allow browser requests from the Office UI
  await app.register(cors, { origin: true });

  // JWT auth — validates Keycloak tokens, decorates request.uruleUser
  await app.register(authMiddleware, {
    publicRoutes: ['/healthz', '/api/v1/infrastructure', '/auth/login'],
  });

  // Error handler
  app.setErrorHandler(errorHandler);

  // Health check
  app.get('/healthz', async () => ({ status: 'ok', service: config.serviceName }));

  // Infrastructure stub — returns running service info for the dashboard
  app.get('/api/v1/infrastructure/containers', async () => {
    return [
      { id: 'registry', name: 'urule-registry', service: 'registry', status: 'running', state: 'running', health: 'healthy', image: 'urule-registry:latest', ports: [{ host: 3001, container: 3000, protocol: 'tcp' }], created: new Date().toISOString(), started_at: new Date().toISOString(), role: 'core', icon: 'Database', description: 'Entity registry', cpu_pct: 0.5, mem_usage_mb: 64, mem_limit_mb: 512, mem_pct: 12.5, net_rx_mb: 0.1, net_tx_mb: 0.2 },
      { id: 'adapter', name: 'urule-adapter', service: 'adapter', status: 'running', state: 'running', health: 'healthy', image: 'urule-adapter:latest', ports: [{ host: 3002, container: 3000, protocol: 'tcp' }], created: new Date().toISOString(), started_at: new Date().toISOString(), role: 'core', icon: 'Cpu', description: 'AI execution engine', cpu_pct: 1.2, mem_usage_mb: 96, mem_limit_mb: 512, mem_pct: 18.8, net_rx_mb: 0.3, net_tx_mb: 0.5 },
      { id: 'approvals', name: 'urule-approvals', service: 'approvals', status: 'running', state: 'running', health: 'healthy', image: 'urule-approvals:latest', ports: [{ host: 3003, container: 3000, protocol: 'tcp' }], created: new Date().toISOString(), started_at: new Date().toISOString(), role: 'core', icon: 'ShieldCheck', description: 'Approval workflows', cpu_pct: 0.3, mem_usage_mb: 48, mem_limit_mb: 512, mem_pct: 9.4, net_rx_mb: 0.05, net_tx_mb: 0.1 },
      { id: 'state', name: 'urule-state', service: 'state', status: 'running', state: 'running', health: 'healthy', image: 'urule-state:latest', ports: [{ host: 3007, container: 3000, protocol: 'tcp' }], created: new Date().toISOString(), started_at: new Date().toISOString(), role: 'core', icon: 'Activity', description: 'Room presence & tasks', cpu_pct: 0.4, mem_usage_mb: 52, mem_limit_mb: 512, mem_pct: 10.2, net_rx_mb: 0.08, net_tx_mb: 0.12 },
      { id: 'packagehub', name: 'urule-packagehub', service: 'packagehub', status: 'running', state: 'running', health: 'healthy', image: 'urule-packagehub:latest', ports: [{ host: 3009, container: 3000, protocol: 'tcp' }], created: new Date().toISOString(), started_at: new Date().toISOString(), role: 'core', icon: 'Package', description: 'Package registry', cpu_pct: 0.2, mem_usage_mb: 44, mem_limit_mb: 512, mem_pct: 8.6, net_rx_mb: 0.04, net_tx_mb: 0.06 },
      { id: 'postgres', name: 'postgres', service: 'postgres', status: 'running', state: 'running', health: 'healthy', image: 'postgres:16-alpine', ports: [{ host: 5432, container: 5432, protocol: 'tcp' }], created: new Date().toISOString(), started_at: new Date().toISOString(), role: 'infra', icon: 'Database', description: 'PostgreSQL database', cpu_pct: 0.8, mem_usage_mb: 128, mem_limit_mb: 1024, mem_pct: 12.5, net_rx_mb: 0.5, net_tx_mb: 0.3 },
      { id: 'nats', name: 'nats', service: 'nats', status: 'running', state: 'running', health: 'healthy', image: 'nats:2-alpine', ports: [{ host: 4222, container: 4222, protocol: 'tcp' }], created: new Date().toISOString(), started_at: new Date().toISOString(), role: 'infra', icon: 'Radio', description: 'NATS message broker', cpu_pct: 0.1, mem_usage_mb: 16, mem_limit_mb: 256, mem_pct: 6.3, net_rx_mb: 0.02, net_tx_mb: 0.03 },
    ];
  });

  // Database
  const db = createDb(config.databaseUrl);

  // Routes
  registerOrgRoutes(app, db);
  registerWorkspaceRoutes(app, db);
  registerAgentRoutes(app, db);
  registerRuntimeRoutes(app, db);
  registerProviderRoutes(app, db);
  registerConversationRoutes(app, db);
  registerIntegrationRoutes(app);
  registerLogRoutes(app);
  registerStatsRoutes(app, db);
  registerAuthRoutes(app);

  return app;
}
