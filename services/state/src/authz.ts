import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { WorkspaceIdResolver } from '@urule/authz-middleware';
import type { RoomManager } from './services/room-manager.js';
import type { TaskManager } from './services/task-manager.js';
import type { WidgetStateManager } from './services/widget-state-manager.js';

/* ------------------------------------------------------------------ *
 * Workspace-id resolvers for `requireMembership` preHandlers.
 *
 * `state` holds everything in memory, so resolvers read the in-memory
 * managers. A resolver returns `null` to make `requireMembership` answer
 * 404 (unknown resource) without leaking existence.
 *
 * The OpenFGA client is built by `bootstrapAuthzClient` from `@urule/authz`
 * — see server.ts.
 * ------------------------------------------------------------------ */

/** Resolver for create routes that carry the workspace id in the body. */
export const bodyWorkspaceResolver: WorkspaceIdResolver = (req: FastifyRequest) => {
  const body = (req.body ?? {}) as { workspaceId?: string };
  return body.workspaceId ?? null;
};

/** Resolver for `/rooms/:roomId/...` routes — the room's workspace. */
export function roomWorkspaceResolver(roomManager: RoomManager): WorkspaceIdResolver {
  return (req: FastifyRequest) => {
    const { roomId } = req.params as { roomId?: string };
    if (!roomId) return null;
    return roomManager.getRoom(roomId)?.workspaceId ?? null;
  };
}

/** Resolver for `/tasks/:taskId/...` routes — the task's workspace. */
export function taskWorkspaceResolver(taskManager: TaskManager): WorkspaceIdResolver {
  return (req: FastifyRequest) => {
    const { taskId } = req.params as { taskId?: string };
    if (!taskId) return null;
    return taskManager.getTask(taskId)?.workspaceId ?? null;
  };
}

/** Resolver for PATCH/DELETE `/widget-state/:instanceId` — the stored instance's workspace. */
export function widgetWorkspaceResolver(widgetStateManager: WidgetStateManager): WorkspaceIdResolver {
  return (req: FastifyRequest) => {
    const { instanceId } = req.params as { instanceId?: string };
    if (!instanceId) return null;
    return widgetStateManager.getState(instanceId)?.workspaceId ?? null;
  };
}

/**
 * Resolver for PUT `/widget-state/:instanceId` (upsert). Prefers the *existing*
 * instance's workspace so a PUT cannot re-home another workspace's widget
 * instance by supplying a different `workspaceId` in the body; falls back to
 * the body workspace when the instance is new.
 */
export function widgetPutWorkspaceResolver(widgetStateManager: WidgetStateManager): WorkspaceIdResolver {
  return (req: FastifyRequest) => {
    const { instanceId } = req.params as { instanceId?: string };
    const existing = instanceId ? widgetStateManager.getState(instanceId) : undefined;
    if (existing) return existing.workspaceId;
    const body = (req.body ?? {}) as { workspaceId?: string };
    return body.workspaceId ?? null;
  };
}

interface MaybeUser {
  id?: string;
  roles?: string[];
}

/**
 * preHandler for presence / typing routes addressed by `:userId` — a caller may
 * only act on their *own* row. 403 otherwise; the `admin` realm role is exempt.
 * Pair it with `requireMembership` so the room is also checked.
 */
export const requireSelfOrAdmin: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = (request as FastifyRequest & { uruleUser?: MaybeUser }).uruleUser;
  const { userId } = request.params as { userId?: string };
  if (user?.roles?.includes('admin')) return;
  if (user?.id && user.id === userId) return;
  reply.code(403).send({
    error: { code: 'FORBIDDEN', message: 'You can only modify your own presence/typing state' },
  });
};
