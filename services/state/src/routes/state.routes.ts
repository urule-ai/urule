import type { FastifyInstance } from 'fastify';
import type { RoomManager } from '../services/room-manager.js';
import type { PresenceManager } from '../services/presence-manager.js';
import type { TaskManager } from '../services/task-manager.js';
import type { WidgetStateManager } from '../services/widget-state-manager.js';
import type { TypingManager } from '../services/typing-manager.js';
import { z } from 'zod';

// -- Zod Schemas ------------------------------------------------------

const createRoomSchema = z.object({
  workspaceId: z.string(),
  name: z.string().min(1),
  type: z.enum(['office', 'meeting', 'private', 'public']),
  description: z.string().optional(),
  capacity: z.number().positive().optional(),
});

const statusEnum = z.enum(['online', 'away', 'busy', 'offline']);

const joinPresenceSchema = z.object({
  userId: z.string(),
  status: statusEnum.optional(),
  workspaceId: z.string(),
});

const updatePresenceSchema = z.object({
  status: statusEnum,
});

const createTaskSchema = z.object({
  workspaceId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['todo', 'in_progress', 'review', 'done', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneeId: z.string().optional(),
  creatorId: z.string(),
  labels: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
  roomId: z.string().optional(),
});

const assignTaskSchema = z.object({
  assigneeId: z.string(),
  reason: z.string().optional(),
});

const putWidgetStateSchema = z.object({
  workspaceId: z.string(),
  state: z.object({}).passthrough(),
});

const patchWidgetStateSchema = z.object({
  patch: z.object({}).passthrough(),
});

// -- Routes -----------------------------------------------------------

export interface StateRouteServices {
  roomManager: RoomManager;
  presenceManager: PresenceManager;
  taskManager: TaskManager;
  widgetStateManager: WidgetStateManager;
  typingManager: TypingManager;
}

const typingPingSchema = z.object({
  userId: z.string().min(1),
  ttlMs: z.number().int().positive().max(60000).optional(),
});

export function registerStateRoutes(app: FastifyInstance, services: StateRouteServices): void {
  const { roomManager, presenceManager, taskManager, widgetStateManager, typingManager } = services;

  // -- Rooms ---------------------------------------------------------

  app.post('/api/v1/rooms', async (req, reply) => {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const room = roomManager.createRoom(parsed.data);
    return reply.status(201).send(room);
  });

  app.get('/api/v1/rooms', async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) {
      return reply.status(400).send({ error: 'Missing required query: workspaceId' });
    }
    const rooms = roomManager.listRooms(workspaceId);
    return reply.send(rooms);
  });

  app.get('/api/v1/rooms/:roomId', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const room = roomManager.getRoom(roomId);
    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    return reply.send(room);
  });

  app.patch('/api/v1/rooms/:roomId', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const updates = req.body as Record<string, unknown>;
    const room = roomManager.updateRoom(roomId, updates);
    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    return reply.send(room);
  });

  app.delete('/api/v1/rooms/:roomId', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const deleted = roomManager.deleteRoom(roomId);
    if (!deleted) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    return reply.status(204).send();
  });

  // -- Presence ------------------------------------------------------

  app.post('/api/v1/rooms/:roomId/presence', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const parsed = joinPresenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { userId, status, workspaceId } = parsed.data;
    const presence = presenceManager.join(userId, roomId, workspaceId, status);
    return reply.status(201).send(presence);
  });

  app.get('/api/v1/rooms/:roomId/presence', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const presences = presenceManager.getPresence(roomId);
    return reply.send(presences);
  });

  app.delete('/api/v1/rooms/:roomId/presence/:userId', async (req, reply) => {
    const { roomId, userId } = req.params as { roomId: string; userId: string };
    presenceManager.leave(userId, roomId);
    return reply.status(204).send();
  });

  app.patch('/api/v1/rooms/:roomId/presence/:userId', async (req, reply) => {
    const { roomId, userId } = req.params as { roomId: string; userId: string };
    const parsed = updatePresenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { status } = parsed.data;
    const presence = presenceManager.updateStatus(userId, roomId, status);
    if (!presence) {
      return reply.status(404).send({ error: 'Presence not found' });
    }
    return reply.send(presence);
  });

  // -- Tasks ---------------------------------------------------------

  app.post('/api/v1/tasks', async (req, reply) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const task = taskManager.createTask(parsed.data);
    return reply.status(201).send(task);
  });

  app.get('/api/v1/tasks', async (req, reply) => {
    const query = req.query as {
      workspaceId?: string;
      assigneeId?: string;
      status?: string;
      roomId?: string;
    };
    const tasks = taskManager.listTasks(
      Object.keys(query).length > 0 ? query as Parameters<typeof taskManager.listTasks>[0] : undefined,
    );
    return reply.send(tasks);
  });

  app.get('/api/v1/tasks/:taskId', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = taskManager.getTask(taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.send(task);
  });

  app.patch('/api/v1/tasks/:taskId', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const updates = req.body as Record<string, unknown>;
    const task = taskManager.updateTask(taskId, updates);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.send(task);
  });

  app.delete('/api/v1/tasks/:taskId', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const deleted = taskManager.deleteTask(taskId);
    if (!deleted) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.status(204).send();
  });

  app.post('/api/v1/tasks/:taskId/assign', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const parsed = assignTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { assigneeId, reason } = parsed.data;
    const transfer = taskManager.assignTask(taskId, assigneeId, reason);
    if (!transfer) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.send(transfer);
  });

  app.get('/api/v1/tasks/:taskId/owners', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = taskManager.getTask(taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    const history = taskManager.getOwnershipHistory(taskId);
    return reply.send(history);
  });

  // -- Widget State --------------------------------------------------

  app.get('/api/v1/widget-state/:instanceId', async (req, reply) => {
    const { instanceId } = req.params as { instanceId: string };
    const state = widgetStateManager.getState(instanceId);
    if (!state) {
      return reply.status(404).send({ error: 'Widget state not found' });
    }
    return reply.send(state);
  });

  app.put('/api/v1/widget-state/:instanceId', async (req, reply) => {
    const { instanceId } = req.params as { instanceId: string };
    const parsed = putWidgetStateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { workspaceId, state } = parsed.data;
    const widgetState = widgetStateManager.setState(instanceId, workspaceId, state);
    return reply.send(widgetState);
  });

  app.patch('/api/v1/widget-state/:instanceId', async (req, reply) => {
    const { instanceId } = req.params as { instanceId: string };
    const parsed = patchWidgetStateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { patch } = parsed.data;
    const widgetState = widgetStateManager.patchState(instanceId, patch);
    if (!widgetState) {
      return reply.status(404).send({ error: 'Widget state not found' });
    }
    return reply.send(widgetState);
  });

  app.delete('/api/v1/widget-state/:instanceId', async (req, reply) => {
    const { instanceId } = req.params as { instanceId: string };
    const deleted = widgetStateManager.deleteState(instanceId);
    if (!deleted) {
      return reply.status(404).send({ error: 'Widget state not found' });
    }
    return reply.status(204).send();
  });

  // -- Typing indicators ---------------------------------------------
  // Short-lived "user is typing" flags. Clients ping every ~3s while
  // the user is actively typing; entries auto-expire after ttlMs
  // (default 6s). Polling /typing returns currently-active typers
  // with stale entries pruned as a side effect.

  app.post('/api/v1/rooms/:roomId/typing', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const parsed = typingPingSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const ping = typingManager.ping(parsed.data.userId, roomId, parsed.data.ttlMs);
    return reply.status(201).send(ping);
  });

  app.get('/api/v1/rooms/:roomId/typing', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    return reply.send(typingManager.listInRoom(roomId));
  });

  app.delete('/api/v1/rooms/:roomId/typing/:userId', async (req, reply) => {
    const { roomId, userId } = req.params as { roomId: string; userId: string };
    const cleared = typingManager.clear(userId, roomId);
    if (!cleared) {
      return reply.status(404).send({ error: 'No active typing indicator for this user/room' });
    }
    return reply.status(204).send();
  });
}
