import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireMembership } from '@urule/authz-middleware';
import type { RoomManager } from '../services/room-manager.js';
import type { PresenceManager } from '../services/presence-manager.js';
import type { TaskManager } from '../services/task-manager.js';
import type { WidgetStateManager } from '../services/widget-state-manager.js';
import type { TypingManager } from '../services/typing-manager.js';
import {
  bodyWorkspaceResolver,
  requireSelfOrAdmin,
  roomWorkspaceResolver,
  taskWorkspaceResolver,
  widgetPutWorkspaceResolver,
  widgetWorkspaceResolver,
} from '../authz.js';
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

// `userId` / `workspaceId` are accepted for backward compatibility but IGNORED:
// the server derives the user from the JWT and the workspace from the room, so
// presence can no longer be forged for another user (#4 case D).
const joinPresenceSchema = z.object({
  userId: z.string().optional(),
  status: statusEnum.optional(),
  workspaceId: z.string().optional(),
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
  // Accepted for back-compat but IGNORED — `creatorId` is derived from the JWT.
  creatorId: z.string().optional(),
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
  state: z.object({}).loose(),
});

const patchWidgetStateSchema = z.object({
  patch: z.object({}).loose(),
});

// `userId` accepted for back-compat but IGNORED — derived from the JWT.
const typingPingSchema = z.object({
  userId: z.string().min(1).optional(),
  ttlMs: z.number().int().positive().max(60000).optional(),
});

// -- Param / Query schemas (reused across routes) ---------------------

const roomIdParams = z.object({ roomId: z.string() });
const roomUserIdParams = z.object({ roomId: z.string(), userId: z.string() });
const taskIdParams = z.object({ taskId: z.string() });
const instanceIdParams = z.object({ instanceId: z.string() });

const listRoomsQuery = z.object({ workspaceId: z.string() });
const listTasksQuery = z.object({
  workspaceId: z.string().optional(),
  assigneeId: z.string().optional(),
  status: z.string().optional(),
  roomId: z.string().optional(),
});

const updateRoomBody = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['office', 'meeting', 'private', 'public']).optional(),
  description: z.string().optional(),
  capacity: z.number().positive().optional(),
});

const updateTaskBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['todo', 'in_progress', 'review', 'done', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneeId: z.string().optional(),
  labels: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
  roomId: z.string().optional(),
});

// -- Routes -----------------------------------------------------------

export interface StateRouteServices {
  roomManager: RoomManager;
  presenceManager: PresenceManager;
  taskManager: TaskManager;
  widgetStateManager: WidgetStateManager;
  typingManager: TypingManager;
}

export function registerStateRoutes(app: FastifyInstance, services: StateRouteServices): void {
  const { roomManager, presenceManager, taskManager, widgetStateManager, typingManager } = services;

  // Resource-level authz preHandlers — each resolves the target resource to a
  // workspace, then `requireMembership` checks the caller is a workspace member.
  const requireRoomMembership = requireMembership(roomWorkspaceResolver(roomManager));
  const requireTaskMembership = requireMembership(taskWorkspaceResolver(taskManager));
  const requireBodyMembership = requireMembership(bodyWorkspaceResolver);
  const requireWidgetMembership = requireMembership(widgetWorkspaceResolver(widgetStateManager));
  const requireWidgetPutMembership = requireMembership(widgetPutWorkspaceResolver(widgetStateManager));

  /** The authenticated caller's id — 401 (via the returned reply) when absent. */
  function callerId(req: FastifyRequest, reply: FastifyReply): string | null {
    const user = (req as FastifyRequest & { uruleUser?: { id?: string } }).uruleUser;
    if (!user?.id) {
      reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return null;
    }
    return user.id;
  }

  // -- Rooms ---------------------------------------------------------

  app.post<{ Body: z.infer<typeof createRoomSchema> }>('/api/v1/rooms', {
    preHandler: requireBodyMembership,
    schema: {
      tags: ['rooms'],
      summary: 'Create a room',
      description: 'Creates a collaboration room scoped to a workspace. The room is the unit presence + typing-indicator endpoints attach to.',
      body: createRoomSchema,
    },
  }, async (req, reply) => {
    const room = roomManager.createRoom(req.body);
    return reply.status(201).send(room);
  });

  app.get<{ Querystring: z.infer<typeof listRoomsQuery> }>('/api/v1/rooms', {
    schema: {
      tags: ['rooms'],
      summary: 'List rooms in a workspace',
      description: 'Returns every room belonging to the given workspace. 400 when `?workspaceId=` is missing.',
      querystring: listRoomsQuery,
    },
  }, async (req, reply) => {
    const rooms = roomManager.listRooms(req.query.workspaceId);
    return reply.send(rooms);
  });

  app.get<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId', {
    schema: {
      tags: ['rooms'],
      summary: 'Get a room by id',
      description: '404 when the id is unknown.',
      params: roomIdParams,
    },
  }, async (req, reply) => {
    const { roomId } = req.params;
    const room = roomManager.getRoom(roomId);
    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    return reply.send(room);
  });

  app.patch<{ Params: { roomId: string }; Body: z.infer<typeof updateRoomBody> }>(
    '/api/v1/rooms/:roomId',
    {
      preHandler: requireRoomMembership,
      schema: {
        tags: ['rooms'],
        summary: 'Update a room',
        description: 'Partial update of a room\'s metadata. 404 when the id is unknown.',
        params: roomIdParams,
        body: updateRoomBody,
      },
    },
    async (req, reply) => {
      const { roomId } = req.params;
      const room = roomManager.updateRoom(roomId, req.body as Record<string, unknown>);
      if (!room) {
        return reply.status(404).send({ error: 'Room not found' });
      }
      return reply.send(room);
    },
  );

  app.delete<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId', {
    preHandler: requireRoomMembership,
    schema: {
      tags: ['rooms'],
      summary: 'Delete a room',
      description: 'Hard-deletes the room. Cascades any in-memory presence + typing-indicator entries for the same room. 204 on success, 404 if the id is unknown.',
      params: roomIdParams,
    },
  }, async (req, reply) => {
    const { roomId } = req.params;
    const deleted = roomManager.deleteRoom(roomId);
    if (!deleted) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    return reply.status(204).send();
  });

  // -- Presence ------------------------------------------------------

  app.post<{ Params: { roomId: string }; Body: z.infer<typeof joinPresenceSchema> }>(
    '/api/v1/rooms/:roomId/presence',
    {
      preHandler: requireRoomMembership,
      schema: {
        tags: ['presence'],
        summary: 'Join a room',
        description: 'Adds a presence row for the authenticated user in this room. The user is taken from the JWT and the workspace from the room — any `userId`/`workspaceId` in the body is ignored. Idempotent — re-joining updates the existing row instead of duplicating.',
        params: roomIdParams,
        body: joinPresenceSchema,
      },
    },
    async (req, reply) => {
      const { roomId } = req.params;
      const { status } = req.body;
      const userId = callerId(req, reply);
      if (!userId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) {
        return reply.status(404).send({ error: 'Room not found' });
      }
      const presence = presenceManager.join(userId, roomId, room.workspaceId, status);
      return reply.status(201).send(presence);
    },
  );

  app.get<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId/presence', {
    schema: {
      tags: ['presence'],
      summary: 'List who is currently in a room',
      description: 'Returns the array of presence rows for the room — each entry includes userId, status (`active | idle | away`), and joinedAt. Empty list (200) when the room has no presence; not 404.',
      params: roomIdParams,
    },
  }, async (req, reply) => {
    const { roomId } = req.params;
    const presences = presenceManager.getPresence(roomId);
    return reply.send(presences);
  });

  app.delete<{ Params: { roomId: string; userId: string } }>(
    '/api/v1/rooms/:roomId/presence/:userId',
    {
      preHandler: [requireRoomMembership, requireSelfOrAdmin],
      schema: {
        tags: ['presence'],
        summary: 'Leave a room',
        description: 'Removes the user\'s presence from the room. 204 always — leaving a room you were never in is a no-op (intentional, makes the close-tab handler idempotent).',
        params: roomUserIdParams,
      },
    },
    async (req, reply) => {
      const { roomId, userId } = req.params;
      presenceManager.leave(userId, roomId);
      return reply.status(204).send();
    },
  );

  app.patch<{
    Params: { roomId: string; userId: string };
    Body: z.infer<typeof updatePresenceSchema>;
  }>('/api/v1/rooms/:roomId/presence/:userId', {
    preHandler: [requireRoomMembership, requireSelfOrAdmin],
    schema: {
      tags: ['presence'],
      summary: 'Update presence status',
      description: 'Switches the user\'s status in this room (e.g., `active` → `away`). 404 when the user has no presence in the room — pre-flight a POST first.',
      params: roomUserIdParams,
      body: updatePresenceSchema,
    },
  }, async (req, reply) => {
    const { roomId, userId } = req.params;
    const { status } = req.body;
    const presence = presenceManager.updateStatus(userId, roomId, status);
    if (!presence) {
      return reply.status(404).send({ error: 'Presence not found' });
    }
    return reply.send(presence);
  });

  // -- Tasks ---------------------------------------------------------

  app.post<{ Body: z.infer<typeof createTaskSchema> }>('/api/v1/tasks', {
    preHandler: requireBodyMembership,
    schema: {
      tags: ['tasks'],
      summary: 'Create a task',
      description: 'Creates a lightweight task record (workspace-scoped, optional room + assignee). The creator is taken from the JWT — any `creatorId` in the body is ignored. Used by langgraph-adapter\'s `create_task` tool when an agent declares work it\'s starting on.',
      body: createTaskSchema,
    },
  }, async (req, reply) => {
    const creatorId = callerId(req, reply);
    if (!creatorId) return;
    const task = taskManager.createTask({ ...req.body, creatorId });
    return reply.status(201).send(task);
  });

  app.get<{ Querystring: z.infer<typeof listTasksQuery> }>('/api/v1/tasks', {
    schema: {
      tags: ['tasks'],
      summary: 'List tasks (filterable)',
      description: 'Returns tasks; optional query filters `?workspaceId=`, `?assigneeId=`, `?status=`, `?roomId=`. With no query, returns every task globally — typically only useful for admin tools.',
      querystring: listTasksQuery,
    },
  }, async (req, reply) => {
    const query = req.query;
    const tasks = taskManager.listTasks(
      Object.keys(query).length > 0 ? query as Parameters<typeof taskManager.listTasks>[0] : undefined,
    );
    return reply.send(tasks);
  });

  app.get<{ Params: { taskId: string } }>('/api/v1/tasks/:taskId', {
    schema: {
      tags: ['tasks'],
      summary: 'Get a task by id',
      description: '404 when the id is unknown.',
      params: taskIdParams,
    },
  }, async (req, reply) => {
    const { taskId } = req.params;
    const task = taskManager.getTask(taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.send(task);
  });

  app.patch<{ Params: { taskId: string }; Body: z.infer<typeof updateTaskBody> }>(
    '/api/v1/tasks/:taskId',
    {
      preHandler: requireTaskMembership,
      schema: {
        tags: ['tasks'],
        summary: 'Update a task',
        description: 'Partial update — title, description, status, priority, etc. For ownership transfer use `/assign` instead. 404 when the id is unknown.',
        params: taskIdParams,
        body: updateTaskBody,
      },
    },
    async (req, reply) => {
      const { taskId } = req.params;
      const task = taskManager.updateTask(taskId, req.body as Record<string, unknown>);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }
      return reply.send(task);
    },
  );

  app.delete<{ Params: { taskId: string } }>('/api/v1/tasks/:taskId', {
    preHandler: requireTaskMembership,
    schema: {
      tags: ['tasks'],
      summary: 'Delete a task',
      description: 'Hard-removes the task. Ownership history is dropped along with it. 204 on success, 404 if the id is unknown.',
      params: taskIdParams,
    },
  }, async (req, reply) => {
    const { taskId } = req.params;
    const deleted = taskManager.deleteTask(taskId);
    if (!deleted) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.status(204).send();
  });

  app.post<{ Params: { taskId: string }; Body: z.infer<typeof assignTaskSchema> }>(
    '/api/v1/tasks/:taskId/assign',
    {
      preHandler: requireTaskMembership,
      schema: {
        tags: ['tasks'],
        summary: 'Transfer task ownership',
        description: 'Assigns the task to a new owner (user or agent id). Records the previous owner + reason in the ownership-history log so `/owners` can show "alice → bob (hired specialist)" trails. 404 when the task id is unknown.',
        params: taskIdParams,
        body: assignTaskSchema,
      },
    },
    async (req, reply) => {
      const { taskId } = req.params;
      const { assigneeId, reason } = req.body;
      const transfer = taskManager.assignTask(taskId, assigneeId, reason);
      if (!transfer) {
        return reply.status(404).send({ error: 'Task not found' });
      }
      return reply.send(transfer);
    },
  );

  app.get<{ Params: { taskId: string } }>('/api/v1/tasks/:taskId/owners', {
    schema: {
      tags: ['tasks'],
      summary: 'Read task ownership history',
      description: 'Returns the chronological log of `/assign` operations on this task — each entry has previousOwnerId, newOwnerId, reason, transferredAt. Useful for "who has worked on this" trails. 404 when the task id is unknown.',
      params: taskIdParams,
    },
  }, async (req, reply) => {
    const { taskId } = req.params;
    const task = taskManager.getTask(taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    const history = taskManager.getOwnershipHistory(taskId);
    return reply.send(history);
  });

  // -- Widget State --------------------------------------------------

  app.get<{ Params: { instanceId: string } }>('/api/v1/widget-state/:instanceId', {
    schema: {
      tags: ['widgets'],
      summary: 'Read persisted widget configuration',
      description: 'Returns the persisted state object for a widget instance — what office-ui\'s `useWidgetConfig` hook hydrates from on mount. 404 when no state has been written for this instance yet (the hook treats 404 as "use defaults").',
      params: instanceIdParams,
    },
  }, async (req, reply) => {
    const { instanceId } = req.params;
    const state = widgetStateManager.getState(instanceId);
    if (!state) {
      return reply.status(404).send({ error: 'Widget state not found' });
    }
    return reply.send(state);
  });

  app.put<{ Params: { instanceId: string }; Body: z.infer<typeof putWidgetStateSchema> }>(
    '/api/v1/widget-state/:instanceId',
    {
      preHandler: requireWidgetPutMembership,
      schema: {
        tags: ['widgets'],
        summary: 'Replace widget configuration (creates if absent)',
        description: 'Full overwrite of the widget instance state. Body `{ workspaceId, state }`. The first save from `useWidgetConfig` lands here (the hook upgrades a missing-row 404 from PATCH to PUT to lazily create the row).',
        params: instanceIdParams,
        body: putWidgetStateSchema,
      },
    },
    async (req, reply) => {
      const { instanceId } = req.params;
      const { workspaceId, state } = req.body;
      const widgetState = widgetStateManager.setState(instanceId, workspaceId, state);
      return reply.send(widgetState);
    },
  );

  app.patch<{ Params: { instanceId: string }; Body: z.infer<typeof patchWidgetStateSchema> }>(
    '/api/v1/widget-state/:instanceId',
    {
      preHandler: requireWidgetMembership,
      schema: {
        tags: ['widgets'],
        summary: 'Partial-update widget configuration',
        description: 'Body `{ patch }` — keys are merged into the existing state, values replace. The hot path for `useWidgetConfig`: settings-panel changes coalesce via the hook\'s 400ms debounce into one PATCH per pause. 404 when no state exists for the instance — the hook auto-falls-back to PUT.',
        params: instanceIdParams,
        body: patchWidgetStateSchema,
      },
    },
    async (req, reply) => {
      const { instanceId } = req.params;
      const { patch } = req.body;
      const widgetState = widgetStateManager.patchState(instanceId, patch);
      if (!widgetState) {
        return reply.status(404).send({ error: 'Widget state not found' });
      }
      return reply.send(widgetState);
    },
  );

  app.delete<{ Params: { instanceId: string } }>('/api/v1/widget-state/:instanceId', {
    preHandler: requireWidgetMembership,
    schema: {
      tags: ['widgets'],
      summary: 'Reset widget configuration',
      description: 'Hard-removes the persisted state. The widget falls back to its manifest defaults on the next load. 204 on success, 404 if no state exists.',
      params: instanceIdParams,
    },
  }, async (req, reply) => {
    const { instanceId } = req.params;
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

  app.post<{ Params: { roomId: string }; Body: z.infer<typeof typingPingSchema> }>(
    '/api/v1/rooms/:roomId/typing',
    {
      preHandler: requireRoomMembership,
      schema: {
        tags: ['typing'],
        summary: 'Ping "user is typing" (TTL-bounded)',
        description: 'Records or refreshes a typing indicator for the authenticated user in this room. The user is taken from the JWT — any `userId` in the body is ignored. Body `{ ttlMs? }` — default TTL 6s; clients ping every ~3s while the user is actively typing. Indicators auto-expire on read.',
        params: roomIdParams,
        body: typingPingSchema,
      },
    },
    async (req, reply) => {
      const { roomId } = req.params;
      const userId = callerId(req, reply);
      if (!userId) return;
      const ping = typingManager.ping(userId, roomId, req.body.ttlMs);
      return reply.status(201).send(ping);
    },
  );

  app.get<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId/typing', {
    schema: {
      tags: ['typing'],
      summary: 'List currently-typing users in a room',
      description: 'Returns active typing indicators (stale entries pruned as a side effect of the read). Empty array when no one is typing — no 404. Polled by the chat UI every ~2s.',
      params: roomIdParams,
    },
  }, async (req, reply) => {
    const { roomId } = req.params;
    return reply.send(typingManager.listInRoom(roomId));
  });

  app.delete<{ Params: { roomId: string; userId: string } }>(
    '/api/v1/rooms/:roomId/typing/:userId',
    {
      preHandler: [requireRoomMembership, requireSelfOrAdmin],
      schema: {
        tags: ['typing'],
        summary: 'Clear a user\'s typing indicator',
        description: 'Eagerly clears the indicator instead of waiting for TTL expiry. Used when the user submits the message — the server-side state catches up to "they\'re done" without consumers having to wait the full 6s.',
        params: roomUserIdParams,
      },
    },
    async (req, reply) => {
      const { roomId, userId } = req.params;
      const cleared = typingManager.clear(userId, roomId);
      if (!cleared) {
        return reply.status(404).send({ error: 'No active typing indicator for this user/room' });
      }
      return reply.status(204).send();
    },
  );
}
