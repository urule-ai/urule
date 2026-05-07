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

  app.post('/api/v1/rooms', {
    schema: {
      tags: ['rooms'],
      summary: 'Create a room',
      description: 'Creates a collaboration room scoped to a workspace. The room is the unit presence + typing-indicator endpoints attach to.',
    },
  }, async (req, reply) => {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const room = roomManager.createRoom(parsed.data);
    return reply.status(201).send(room);
  });

  app.get('/api/v1/rooms', {
    schema: {
      tags: ['rooms'],
      summary: 'List rooms in a workspace',
      description: 'Returns every room belonging to the given workspace. 400 when `?workspaceId=` is missing.',
    },
  }, async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) {
      return reply.status(400).send({ error: 'Missing required query: workspaceId' });
    }
    const rooms = roomManager.listRooms(workspaceId);
    return reply.send(rooms);
  });

  app.get('/api/v1/rooms/:roomId', {
    schema: {
      tags: ['rooms'],
      summary: 'Get a room by id',
      description: '404 when the id is unknown.',
    },
  }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const room = roomManager.getRoom(roomId);
    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    return reply.send(room);
  });

  app.patch('/api/v1/rooms/:roomId', {
    schema: {
      tags: ['rooms'],
      summary: 'Update a room',
      description: 'Partial update of a room\'s metadata. 404 when the id is unknown.',
    },
  }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const updates = req.body as Record<string, unknown>;
    const room = roomManager.updateRoom(roomId, updates);
    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    return reply.send(room);
  });

  app.delete('/api/v1/rooms/:roomId', {
    schema: {
      tags: ['rooms'],
      summary: 'Delete a room',
      description: 'Hard-deletes the room. Cascades any in-memory presence + typing-indicator entries for the same room. 204 on success, 404 if the id is unknown.',
    },
  }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const deleted = roomManager.deleteRoom(roomId);
    if (!deleted) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    return reply.status(204).send();
  });

  // -- Presence ------------------------------------------------------

  app.post('/api/v1/rooms/:roomId/presence', {
    schema: {
      tags: ['presence'],
      summary: 'Join a room',
      description: 'Adds a presence row for the user in this room. Body `{ userId, status, workspaceId }`. Idempotent — re-joining the same user updates their existing row instead of duplicating.',
    },
  }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const parsed = joinPresenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { userId, status, workspaceId } = parsed.data;
    const presence = presenceManager.join(userId, roomId, workspaceId, status);
    return reply.status(201).send(presence);
  });

  app.get('/api/v1/rooms/:roomId/presence', {
    schema: {
      tags: ['presence'],
      summary: 'List who is currently in a room',
      description: 'Returns the array of presence rows for the room — each entry includes userId, status (`active | idle | away`), and joinedAt. Empty list (200) when the room has no presence; not 404.',
    },
  }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const presences = presenceManager.getPresence(roomId);
    return reply.send(presences);
  });

  app.delete('/api/v1/rooms/:roomId/presence/:userId', {
    schema: {
      tags: ['presence'],
      summary: 'Leave a room',
      description: 'Removes the user\'s presence from the room. 204 always — leaving a room you were never in is a no-op (intentional, makes the close-tab handler idempotent).',
    },
  }, async (req, reply) => {
    const { roomId, userId } = req.params as { roomId: string; userId: string };
    presenceManager.leave(userId, roomId);
    return reply.status(204).send();
  });

  app.patch('/api/v1/rooms/:roomId/presence/:userId', {
    schema: {
      tags: ['presence'],
      summary: 'Update presence status',
      description: 'Switches the user\'s status in this room (e.g., `active` → `away`). 404 when the user has no presence in the room — pre-flight a POST first.',
    },
  }, async (req, reply) => {
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

  app.post('/api/v1/tasks', {
    schema: {
      tags: ['tasks'],
      summary: 'Create a task',
      description: 'Creates a lightweight task record (workspace-scoped, optional room + assignee). Used by langgraph-adapter\'s `create_task` tool when an agent declares work it\'s starting on.',
    },
  }, async (req, reply) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const task = taskManager.createTask(parsed.data);
    return reply.status(201).send(task);
  });

  app.get('/api/v1/tasks', {
    schema: {
      tags: ['tasks'],
      summary: 'List tasks (filterable)',
      description: 'Returns tasks; optional query filters `?workspaceId=`, `?assigneeId=`, `?status=`, `?roomId=`. With no query, returns every task globally — typically only useful for admin tools.',
    },
  }, async (req, reply) => {
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

  app.get('/api/v1/tasks/:taskId', {
    schema: {
      tags: ['tasks'],
      summary: 'Get a task by id',
      description: '404 when the id is unknown.',
    },
  }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = taskManager.getTask(taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.send(task);
  });

  app.patch('/api/v1/tasks/:taskId', {
    schema: {
      tags: ['tasks'],
      summary: 'Update a task',
      description: 'Partial update — title, description, status, priority, etc. For ownership transfer use `/assign` instead. 404 when the id is unknown.',
    },
  }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const updates = req.body as Record<string, unknown>;
    const task = taskManager.updateTask(taskId, updates);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.send(task);
  });

  app.delete('/api/v1/tasks/:taskId', {
    schema: {
      tags: ['tasks'],
      summary: 'Delete a task',
      description: 'Hard-removes the task. Ownership history is dropped along with it. 204 on success, 404 if the id is unknown.',
    },
  }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const deleted = taskManager.deleteTask(taskId);
    if (!deleted) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.status(204).send();
  });

  app.post('/api/v1/tasks/:taskId/assign', {
    schema: {
      tags: ['tasks'],
      summary: 'Transfer task ownership',
      description: 'Assigns the task to a new owner (user or agent id). Records the previous owner + reason in the ownership-history log so `/owners` can show "alice → bob (hired specialist)" trails. 404 when the task id is unknown.',
    },
  }, async (req, reply) => {
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

  app.get('/api/v1/tasks/:taskId/owners', {
    schema: {
      tags: ['tasks'],
      summary: 'Read task ownership history',
      description: 'Returns the chronological log of `/assign` operations on this task — each entry has previousOwnerId, newOwnerId, reason, transferredAt. Useful for "who has worked on this" trails. 404 when the task id is unknown.',
    },
  }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = taskManager.getTask(taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    const history = taskManager.getOwnershipHistory(taskId);
    return reply.send(history);
  });

  // -- Widget State --------------------------------------------------

  app.get('/api/v1/widget-state/:instanceId', {
    schema: {
      tags: ['widgets'],
      summary: 'Read persisted widget configuration',
      description: 'Returns the persisted state object for a widget instance — what office-ui\'s `useWidgetConfig` hook hydrates from on mount. 404 when no state has been written for this instance yet (the hook treats 404 as "use defaults").',
    },
  }, async (req, reply) => {
    const { instanceId } = req.params as { instanceId: string };
    const state = widgetStateManager.getState(instanceId);
    if (!state) {
      return reply.status(404).send({ error: 'Widget state not found' });
    }
    return reply.send(state);
  });

  app.put('/api/v1/widget-state/:instanceId', {
    schema: {
      tags: ['widgets'],
      summary: 'Replace widget configuration (creates if absent)',
      description: 'Full overwrite of the widget instance state. Body `{ workspaceId, state }`. The first save from `useWidgetConfig` lands here (the hook upgrades a missing-row 404 from PATCH to PUT to lazily create the row).',
    },
  }, async (req, reply) => {
    const { instanceId } = req.params as { instanceId: string };
    const parsed = putWidgetStateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { workspaceId, state } = parsed.data;
    const widgetState = widgetStateManager.setState(instanceId, workspaceId, state);
    return reply.send(widgetState);
  });

  app.patch('/api/v1/widget-state/:instanceId', {
    schema: {
      tags: ['widgets'],
      summary: 'Partial-update widget configuration',
      description: 'Body `{ patch }` — keys are merged into the existing state, values replace. The hot path for `useWidgetConfig`: settings-panel changes coalesce via the hook\'s 400ms debounce into one PATCH per pause. 404 when no state exists for the instance — the hook auto-falls-back to PUT.',
    },
  }, async (req, reply) => {
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

  app.delete('/api/v1/widget-state/:instanceId', {
    schema: {
      tags: ['widgets'],
      summary: 'Reset widget configuration',
      description: 'Hard-removes the persisted state. The widget falls back to its manifest defaults on the next load. 204 on success, 404 if no state exists.',
    },
  }, async (req, reply) => {
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

  app.post('/api/v1/rooms/:roomId/typing', {
    schema: {
      tags: ['typing'],
      summary: 'Ping "user is typing" (TTL-bounded)',
      description: 'Records or refreshes a typing indicator for `userId` in this room. Body `{ userId, ttlMs? }` — default TTL 6s; clients ping every ~3s while the user is actively typing. Indicators auto-expire on read; no explicit cleanup needed.',
    },
  }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const parsed = typingPingSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const ping = typingManager.ping(parsed.data.userId, roomId, parsed.data.ttlMs);
    return reply.status(201).send(ping);
  });

  app.get('/api/v1/rooms/:roomId/typing', {
    schema: {
      tags: ['typing'],
      summary: 'List currently-typing users in a room',
      description: 'Returns active typing indicators (stale entries pruned as a side effect of the read). Empty array when no one is typing — no 404. Polled by the chat UI every ~2s.',
    },
  }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    return reply.send(typingManager.listInRoom(roomId));
  });

  app.delete('/api/v1/rooms/:roomId/typing/:userId', {
    schema: {
      tags: ['typing'],
      summary: 'Clear a user\'s typing indicator',
      description: 'Eagerly clears the indicator instead of waiting for TTL expiry. Used when the user submits the message — the server-side state catches up to "they\'re done" without consumers having to wait the full 6s.',
    },
  }, async (req, reply) => {
    const { roomId, userId } = req.params as { roomId: string; userId: string };
    const cleared = typingManager.clear(userId, roomId);
    if (!cleared) {
      return reply.status(404).send({ error: 'No active typing indicator for this user/room' });
    }
    return reply.status(204).send();
  });
}
