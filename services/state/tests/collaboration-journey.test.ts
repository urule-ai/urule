import { describe, it, expect, beforeEach } from 'vitest';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

describe('State Service — Collaboration Journeys', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer();
    await app.ready();
  });

  // -- Multi-user collaboration journey -------------------------------

  describe('Multi-user collaboration journey', () => {
    it('user1+user2 join, swap task ownership, typing flows end-to-end', async () => {
      // 1. user1 creates a room
      const roomRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rooms',
        payload: { workspaceId: 'ws-1', name: 'Project Alpha', type: 'office' },
      });
      expect(roomRes.statusCode).toBe(201);
      const roomId = roomRes.json().id;

      // 2. user1 joins presence
      const join1 = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${roomId}/presence`,
        payload: { userId: 'user-1', workspaceId: 'ws-1' },
      });
      expect(join1.statusCode).toBe(201);

      // 3. user2 joins presence
      const join2 = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${roomId}/presence`,
        payload: { userId: 'user-2', workspaceId: 'ws-1' },
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

      // 5. user1 creates a task assigned to themselves
      const taskRes = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        payload: {
          workspaceId: 'ws-1',
          title: 'Investigate bug',
          creatorId: 'user-1',
          assigneeId: 'user-1',
          roomId,
        },
      });
      expect(taskRes.statusCode).toBe(201);
      const taskId = taskRes.json().id;

      // 6. user2 takes ownership
      const assignRes = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/assign`,
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

      // 8. user1 starts typing
      const ping = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${roomId}/typing`,
        payload: { userId: 'user-1' },
      });
      expect(ping.statusCode).toBe(201);

      // 9. typing list contains user1
      const typingRes = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/typing`,
      });
      expect(typingRes.statusCode).toBe(200);
      const typing = typingRes.json();
      expect(typing).toHaveLength(1);
      expect(typing[0].userId).toBe('user-1');

      // 10. clear typing
      const clearRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/rooms/${roomId}/typing/user-1`,
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
      const joinRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rooms/room-presence/presence',
        payload: { userId: 'u1', workspaceId: 'ws-1' },
      });
      expect(joinRes.statusCode).toBe(201);
      expect(joinRes.json().status).toBe('online');

      const toAway = await app.inject({
        method: 'PATCH',
        url: '/api/v1/rooms/room-presence/presence/u1',
        payload: { status: 'away' },
      });
      expect(toAway.statusCode).toBe(200);
      expect(toAway.json().status).toBe('away');

      const afterAway = await app.inject({
        method: 'GET',
        url: '/api/v1/rooms/room-presence/presence',
      });
      expect(afterAway.json()).toHaveLength(1);
      expect(afterAway.json()[0].status).toBe('away');

      const toBusy = await app.inject({
        method: 'PATCH',
        url: '/api/v1/rooms/room-presence/presence/u1',
        payload: { status: 'busy' },
      });
      expect(toBusy.statusCode).toBe(200);
      expect(toBusy.json().status).toBe('busy');

      const afterBusy = await app.inject({
        method: 'GET',
        url: '/api/v1/rooms/room-presence/presence',
      });
      expect(afterBusy.json()[0].status).toBe('busy');

      const leaveRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/rooms/room-presence/presence/u1',
      });
      expect(leaveRes.statusCode).toBe(204);

      const empty = await app.inject({
        method: 'GET',
        url: '/api/v1/rooms/room-presence/presence',
      });
      expect(empty.json()).toHaveLength(0);
    });

    it('PATCH presence on a user not in the room returns 404', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/rooms/room-X/presence/u-ghost',
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
        payload: {
          workspaceId: 'ws-1',
          title: 'Chain task',
          creatorId: 'u1',
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
        payload: {
          workspaceId: 'ws-1',
          title: 'Doomed task',
          creatorId: 'u1',
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
      const roomId = 'r1';

      // user1 with default TTL (long-lived for the duration of this test)
      const ping1 = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${roomId}/typing`,
        payload: { userId: 'user-1' },
      });
      expect(ping1.statusCode).toBe(201);

      // user2 with a short TTL so we can observe expiry
      const ping2 = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${roomId}/typing`,
        payload: { userId: 'user-2', ttlMs: 50 },
      });
      expect(ping2.statusCode).toBe(201);

      // immediately: both visible
      const both = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/typing`,
      });
      expect(both.statusCode).toBe(200);
      expect(both.json()).toHaveLength(2);

      // wait until user2's ping is past TTL
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const onlyOne = await app.inject({
        method: 'GET',
        url: `/api/v1/rooms/${roomId}/typing`,
      });
      expect(onlyOne.statusCode).toBe(200);
      const stillTyping = onlyOne.json();
      expect(stillTyping).toHaveLength(1);
      expect(stillTyping[0].userId).toBe('user-1');

      // explicitly clear user1's indicator
      const clearRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/rooms/${roomId}/typing/user-1`,
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
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/rooms/r1/typing/ghost',
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
