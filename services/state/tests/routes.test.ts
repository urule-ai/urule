import { describe, it, expect, beforeEach } from 'vitest';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

describe('State Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer();
    await app.ready();
  });

  // -- Room CRUD -----------------------------------------------------

  it('POST /api/v1/rooms creates room, GET returns it', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { workspaceId: 'ws-1', name: 'Main Office', type: 'office' },
    });
    expect(createRes.statusCode).toBe(201);
    const room = createRes.json();
    expect(room.id).toBeDefined();
    expect(room.name).toBe('Main Office');

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/rooms/${room.id}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().name).toBe('Main Office');
  });

  // -- Presence ------------------------------------------------------

  it('POST presence join, GET presence shows user', async () => {
    // Presence must attach to a real room — the membership preHandler resolves
    // the room's workspace, so create the room first.
    const roomRes = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { workspaceId: 'ws-1', name: 'Room', type: 'office' },
    });
    const roomId = roomRes.json().id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomId}/presence`,
      payload: {},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/rooms/${roomId}/presence`,
    });
    expect(res.statusCode).toBe(200);
    const presences = res.json();
    expect(presences).toHaveLength(1);
    // userId comes from the JWT (SKIP_AUTH mock user), not the request body.
    expect(presences[0].userId).toBe('dev-user-001');
    expect(presences[0].status).toBe('online');
  });

  // -- Tasks ---------------------------------------------------------

  it('POST /api/v1/tasks creates task, GET with filter returns it', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { workspaceId: 'ws-1', title: 'Fix bug', creatorId: 'user-1' },
    });
    expect(createRes.statusCode).toBe(201);
    const task = createRes.json();
    expect(task.title).toBe('Fix bug');
    expect(task.status).toBe('todo');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?workspaceId=ws-1',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toHaveLength(1);
  });

  it('POST assign changes assignee', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { workspaceId: 'ws-1', title: 'Assign me', creatorId: 'user-1', assigneeId: 'user-1' },
    });
    const taskId = createRes.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/assign`,
      payload: { assigneeId: 'user-2', reason: 'Handoff' },
    });
    expect(res.statusCode).toBe(200);
    const transfer = res.json();
    expect(transfer.fromUserId).toBe('user-1');
    expect(transfer.toUserId).toBe('user-2');
  });

  // -- Widget State --------------------------------------------------

  it('PUT widget-state, GET returns it', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/widget-state/widget-1',
      payload: { workspaceId: 'ws-1', state: { count: 0 } },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().state).toEqual({ count: 0 });

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/widget-state/widget-1',
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().state).toEqual({ count: 0 });
  });

  it('PATCH widget-state merges', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/widget-state/widget-1',
      payload: { workspaceId: 'ws-1', state: { count: 0, label: 'test' } },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/widget-state/widget-1',
      payload: { patch: { count: 5 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toEqual({ count: 5, label: 'test' });
  });
});
