import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authMiddleware } from '@urule/auth-middleware';
import { PresenceManager } from './services/presence-manager.js';
import { RoomManager } from './services/room-manager.js';
import { TaskManager } from './services/task-manager.js';
import { WidgetStateManager } from './services/widget-state-manager.js';
import { registerStateRoutes } from './routes/state.routes.js';

export async function buildServer() {
  const app = Fastify({ logger: false });

  // Register CORS
  await app.register(cors, { origin: true });

  // Auth middleware
  await app.register(authMiddleware, { publicRoutes: ['/healthz'] });

  const presenceManager = new PresenceManager();
  const roomManager = new RoomManager();
  const taskManager = new TaskManager();
  const widgetStateManager = new WidgetStateManager();

  app.get('/healthz', async () => ({ status: 'ok' }));
  registerStateRoutes(app, { presenceManager, roomManager, taskManager, widgetStateManager });
  return app;
}
