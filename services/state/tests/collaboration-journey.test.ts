import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildServer } from '../src/server.js';

/**
 * Resource-level authz is enforced on every write route, and presence/typing
 * identity is derived from the JWT. To exercise multi-user collaboration these
 * journeys override the SKIP_AUTH mock user per-request via an `x-test-user`
 * header. The injected users carry the `admin` role so `requireMembership`
 * (which runs against an empty in-memory mock authz store here) bypasses — the
 * membership checks themselves are covered by `authz-enforcement.test.ts`.
 */
async function buildApp(): Promise<FastifyInstance> {
  const app = await buildServer();
  app.addHook('onRequest', async (req) => {
    const u = req.headers['x-test-user'];
    if (typeof u === 'string') {
      (req as FastifyRequest & { uruleUser: unknown }).uruleUser = {
        id: u,
        username: u,
        roles: ['admin'],
      };
    }
  });
  await app.ready();
  return app;
}

/** Inject helper that tags the request with a test user. */
function as(user: string) {
  return { 'x-test-user': user };
}

describe('State Service — Collaboration Journeys', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  // -- Multi-user collaboration journey -------------------------------

  describe('Multi-user collaboration journey', () => {
    it('user1+user2 join, swap task ownership, typing flows end-to-end', async () => {
      // 1. user-1 creates a room
      const roomRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rooms',
        headers: as('user-1'),
        payload: { workspaceId: 'ws-1', name: 'Project Alpha', type: 'office' },
      });
      expect(roomRes.statusCode).toBe(201);
      const roomId = roomRes.json().id;

      // 2. user-1 joins presence (identity from the JWT)
      const join1 = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${roomId}/presence`,
        headers: as('user-1'),
        payload: {},
      });
      expect(join1.statusCode).toBe(201);

      // 3. user-2 joins presence
      const join2 = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${roomId}/presence`,
        headers: as('user-2'),
        payload: {},
      });
      expect(join2.statusCode).toBe(201);

      // 4. GET presence shows both users
      const presenceRes = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/presence`,
      });
      expect(presenceRes.statusCode).toBe(200);
      const presences = presenceRes.json();
      expect(presences).toHaveLength(2);
      const userIds = presences.map((p: { userId: string }) => p.userId).sort();
      expect(userIds).toEqual(['user-1', 'user-2']);

      // 5. user-1 creates a task assigned to themselves (creatorId from the JWT)
      const taskRes = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: as('user-1'),
        payload: {
          workspaceId: 'ws-1',
          title: 'Investigate bug',
          assigneeId: 'user-1',
          roomId,
        },
      });
      expect(taskRes.statusCode).toBe(201);
      const task = taskRes.json();
      expect(task.creatorId).toBe('user-1');
      const taskId = task.id;

      // 6. user-2 takes ownership
      const assignRes = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/assign`,
        headers: as('user-2'),
        payload: { assigneeId: 'user-2', reason: 'Taking over' },
      });
      expect(assignRes.statusCode).toBe(200);
      const transfer = assignRes.json();
      expect(transfer.fromUserId).toBe('user-1');
      expect(transfer.toUserId).toBe('user-2');

      // 7. listing tasks by room shows updated assignee
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks?roomId=${roomId}`,
      });
      expect(listRes.statusCode).toBe(200);
      const tasks = listRes.json();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].assigneeId).toBe('user-2');

      // 8. user-1 starts typing (identity from the JWT)
      const ping = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${roomId}/typing`,
        headers: as('user-1'),
        payload: {},
      });
      expect(ping.statusCode).toBe(201);

      // 9. typing list contains user-1
      const typingRes = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/typing`,
      });
      expect(typingRes.statusCode).toBe(200);
      const typing = typingRes.json();
      expect(typing).toHaveLength(1);
      expect(typing[0].userId).toBe('user-1');

      // 10. user-1 clears their own typing indicator
      const clearRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/rooms/${roomId}/typing/user-1`,
        headers: as('user-1'),
      });
      expect(clearRes.statusCode).toBe(204);

      // 11. typing list now empty
      const typingAfter = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/typing`,
      });
      expect(typingAfter.statusCode).toBe(200);
      expect(typingAfter.json()).toHaveLength(0);
    });
  });

  // -- Room update / delete lifecycle ---------------------------------

  describe('Room update / delete lifecycle', () => {
    it('PATCH /:roomId mutates name+description; DELETE /:roomId then GET → 404', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rooms',
        payload: { workspaceId: 'ws-1', name: 'Original', type: 'office' },
      });
      const roomId = createRes.json().id;

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/rooms/${roomId}`,
        payload: { name: 'New Name', description: 'updated' },
      });
      expect(patchRes.statusCode).toBe(200);
      const updated = patchRes.json();
      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('updated');

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/rooms/${roomId}`,
      });
      expect(deleteRes.statusCode).toBe(204);

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('PATCH unknown room returns 404', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/rooms/01HZZZ0000000000000000000000',
        payload: { name: 'Anything' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('DELETE unknown room returns 404', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/rooms/01HZZZ0000000000000000000000',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -- Presence status transitions ------------------------------------

  describe('Presence status transitions', () => {
    it('online → away → busy → leave', async () => {
      const roomRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rooms',
        headers: as('u1'),
        payload: { workspaceId: 'ws-1', name: 'Presence Room', type: 'office' },
      });
      const roomId = roomRes.json().id;

      const joinRes = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${roomId}/presence`,
        headers: as('u1'),
        payload: {},
      });
      expect(joinRes.statusCode).toBe(201);
      expect(joinRes.json().status).toBe('online');

      const toAway = await app.inject({
        method: 'PATCH',
        url: `/api/v1/rooms/${roomId}/presence/u1`,
        headers: as('u1'),
        payload: { status: 'away' },
      });
      expect(toAway.statusCode).toBe(200);
      expect(toAway.json().status).toBe('away');

      const afterAway = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/presence`,
      });
      expect(afterAway.json()).toHaveLength(1);
      expect(afterAway.json()[0].status).toBe('away');

      const toBusy = await app.inject({
        method: 'PATCH',
        url: `/api/v1/rooms/${roomId}/presence/u1`,
        headers: as('u1'),
        payload: { status: 'busy' },
      });
      expect(toBusy.statusCode).toBe(200);
      expect(toBusy.json().status).toBe('busy');

      const afterBusy = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/presence`,
      });
      expect(afterBusy.json()[0].status).toBe('busy');

      const leaveRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/rooms/${roomId}/presence/u1`,
        headers: as('u1'),
      });
      expect(leaveRes.statusCode).toBe(204);

      const empty = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/presence`,
      });
      expect(empty.json()).toHaveLength(0);
    });

    it('PATCH presence for a user not in the room returns 404', async () => {
      const roomRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rooms',
        payload: { workspaceId: 'ws-1', name: 'Empty Room', type: 'office' },
      });
      const roomId = roomRes.json().id;

      // dev-user-001 (SKIP_AUTH mock admin) — admin bypasses requireSelfOrAdmin,
      // so this reaches the handler and 404s on the missing presence row.
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/rooms/${roomId}/presence/u-ghost`,
        payload: { status: 'busy' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -- Task status transitions + ownership history --------------------

  describe('Task status transitions + ownership history', () => {
    it('todo → in_progress + assign + history reflects chain', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: as('u1'),
        payload: {
          workspaceId: 'ws-1',
          title: 'Chain task',
          assigneeId: 'u1',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const taskId = createRes.json().id;
      expect(createRes.json().status).toBe('todo');

      const patchStatus = await app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${taskId}`,
        payload: { status: 'in_progress' },
      });
      expect(patchStatus.statusCode).toBe(200);
      expect(patchStatus.json().status).toBe('in_progress');

      const firstAssign = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/assign`,
        payload: { assigneeId: 'u2', reason: 'specialist' },
      });
      expect(firstAssign.statusCode).toBe(200);
      expect(firstAssign.json().fromUserId).toBe('u1');
      expect(firstAssign.json().toUserId).toBe('u2');

      const history1 = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskId}/owners`,
      });
      expect(history1.statusCode).toBe(200);
      const list1 = history1.json();
      expect(list1).toHaveLength(1);
      expect(list1[0].fromUserId).toBe('u1');
      expect(list1[0].toUserId).toBe('u2');
      expect(list1[0].reason).toBe('specialist');

      const secondAssign = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/assign`,
        payload: { assigneeId: 'u3', reason: 'escalated' },
      });
      expect(secondAssign.statusCode).toBe(200);

      const history2 = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskId}/owners`,
      });
      expect(history2.statusCode).toBe(200);
      const list2 = history2.json();
      expect(list2).toHaveLength(2);
      expect(list2[0].fromUserId).toBe('u1');
      expect(list2[0].toUserId).toBe('u2');
      expect(list2[1].fromUserId).toBe('u2');
      expect(list2[1].toUserId).toBe('u3');
      expect(list2[1].reason).toBe('escalated');
    });
  });

  // -- Task delete cascade --------------------------------------------

  describe('Task delete cascade', () => {
    it('DELETE /tasks/:taskId removes task + ownership history (GET 404 for both)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: as('u1'),
        payload: {
          workspaceId: 'ws-1',
          title: 'Doomed task',
          assigneeId: 'u1',
        },
      });
      const taskId = createRes.json().id;

      const assignRes = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/assign`,
        payload: { assigneeId: 'u2', reason: 'reassigned' },
      });
      expect(assignRes.statusCode).toBe(200);

      const ownersBefore = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskId}/owners`,
      });
      expect(ownersBefore.statusCode).toBe(200);
      expect(ownersBefore.json()).toHaveLength(1);

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/tasks/${taskId}`,
      });
      expect(deleteRes.statusCode).toBe(204);

      const taskAfter = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskId}`,
      });
      expect(taskAfter.statusCode).toBe(404);

      const ownersAfter = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskId}/owners`,
      });
      expect(ownersAfter.statusCode).toBe(404);
    });

    it('DELETE unknown task returns 404', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/tasks/01HZZZ0000000000000000000000',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -- Widget state PATCH on missing instance -------------------------

  describe('Widget state PATCH on missing instance', () => {
    it('PATCH /widget-state/:instanceId without prior PUT returns 404', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/widget-state/widget-ghost',
        payload: { patch: { x: 1 } },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -- Typing indicator multi-user ------------------------------------

  describe('Typing indicator multi-user', () => {
    it('two users typing → list shows both → one TTL-expires → DELETE the other → empty', async () => {
      const roomRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rooms',
        headers: as('user-1'),
        payload: { workspaceId: 'ws-1', name: 'Typing Room', type: 'office' },
      });
      const roomId = roomRes.json().id;

      // user-1 with default TTL (long-lived for the duration of this test)
      const ping1 = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${roomId}/typing`,
        headers: as('user-1'),
        payload: {},
      });
      expect(ping1.statusCode).toBe(201);

      // user-2 with a short TTL so we can observe expiry
      const ping2 = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${roomId}/typing`,
        headers: as('user-2'),
        payload: { ttlMs: 50 },
      });
      expect(ping2.statusCode).toBe(201);

      // immediately: both visible
      const both = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/typing`,
      });
      expect(both.statusCode).toBe(200);
      expect(both.json()).toHaveLength(2);

      // wait until user-2's ping is past TTL
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const onlyOne = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/typing`,
      });
      expect(onlyOne.statusCode).toBe(200);
      const stillTyping = onlyOne.json();
      expect(stillTyping).toHaveLength(1);
      expect(stillTyping[0].userId).toBe('user-1');

      // user-1 explicitly clears their own indicator
      const clearRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/rooms/${roomId}/typing/user-1`,
        headers: as('user-1'),
      });
      expect(clearRes.statusCode).toBe(204);

      const empty = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/typing`,
      });
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toHaveLength(0);
    });

    it('DELETE typing for a user with no active ping returns 404', async () => {
      const roomRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rooms',
        payload: { workspaceId: 'ws-1', name: 'Typing Room 2', type: 'office' },
      });
      const roomId = roomRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/rooms/${roomId}/typing/ghost`,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
