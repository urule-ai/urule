import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { authzMiddleware } from '@urule/authz-middleware';
import { createMockAuthzClient } from '@urule/authz/testing';
import type { RelationTuple } from '@urule/authz';
import { PresenceManager } from '../src/services/presence-manager.js';
import { RoomManager } from '../src/services/room-manager.js';
import { TaskManager } from '../src/services/task-manager.js';
import { WidgetStateManager } from '../src/services/widget-state-manager.js';
import { TypingManager } from '../src/services/typing-manager.js';
import { registerStateRoutes } from '../src/routes/state.routes.js';

/* ------------------------------------------------------------------ *
 * Phase C — requireMembership enforcement + identity-spoofing fix on
 * the state service write routes. A custom onRequest hook stands in
 * for @urule/auth-middleware so each test picks the request's user.
 * ------------------------------------------------------------------ */

type TestUser = { id: string; roles?: string[] } | null;

interface Built {
  app: FastifyInstance;
  roomManager: RoomManager;
}

async function buildApp(opts: { user: TestUser; tuples?: RelationTuple[] }): Promise<Built> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorateRequest('uruleUser', null);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { uruleUser: TestUser }).uruleUser = opts.user;
  });

  const authz = createMockAuthzClient();
  if (opts.tuples) await authz.writeTuples(opts.tuples);
  await app.register(authzMiddleware, { authzClient: authz });

  const roomManager = new RoomManager();
  registerStateRoutes(app, {
    roomManager,
    presenceManager: new PresenceManager(),
    taskManager: new TaskManager(),
    widgetStateManager: new WidgetStateManager(),
    typingManager: new TypingManager(),
  });
  await app.ready();
  return { app, roomManager };
}

const ALICE = { id: 'alice' };
const BOB = { id: 'bob' };
const ROOT = { id: 'root', roles: ['admin'] };
const MEMBER_OF_WS1: RelationTuple[] = [
  { user: 'user:alice', relation: 'member', object: 'workspace:ws-1' },
];

describe('Phase C — state authz enforcement', () => {
  it('POST /rooms — 403 for a non-member of the target workspace', async () => {
    const { app } = await buildApp({ user: BOB }); // no tuples
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { workspaceId: 'ws-1', name: 'R', type: 'office' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('POST /rooms — 201 for a workspace member', async () => {
    const { app } = await buildApp({ user: ALICE, tuples: MEMBER_OF_WS1 });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { workspaceId: 'ws-1', name: 'R', type: 'office' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST /rooms — 201 for an `admin` user with no tuples (bypass)', async () => {
    const { app } = await buildApp({ user: ROOT });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { workspaceId: 'ws-1', name: 'R', type: 'office' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('DELETE /rooms/:roomId — 403 for a non-member of the room\'s workspace', async () => {
    const { app, roomManager } = await buildApp({ user: BOB });
    const room = roomManager.createRoom({ workspaceId: 'ws-1', name: 'R', type: 'office' });
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/rooms/${room.id}` });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH /rooms/:roomId — 404 when the room does not exist', async () => {
    const { app } = await buildApp({ user: ALICE, tuples: MEMBER_OF_WS1 });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/rooms/does-not-exist',
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('POST presence — the presence row is keyed to the JWT user, not the body', async () => {
    const { app, roomManager } = await buildApp({ user: ALICE, tuples: MEMBER_OF_WS1 });
    const room = roomManager.createRoom({ workspaceId: 'ws-1', name: 'R', type: 'office' });

    const join = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.id}/presence`,
      payload: { userId: 'victim' }, // spoof attempt — must be ignored
    });
    expect(join.statusCode).toBe(201);
    expect(join.json().userId).toBe('alice');

    const list = await app.inject({ method: 'GET', url: `/api/v1/rooms/${room.id}/presence` });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].userId).toBe('alice');
  });

  it('PATCH presence/:userId — 403 when targeting another user (requireSelfOrAdmin)', async () => {
    const { app, roomManager } = await buildApp({ user: ALICE, tuples: MEMBER_OF_WS1 });
    const room = roomManager.createRoom({ workspaceId: 'ws-1', name: 'R', type: 'office' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/rooms/${room.id}/presence/bob`,
      payload: { status: 'away' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /tasks — creatorId comes from the JWT, not the body', async () => {
    const { app } = await buildApp({ user: ALICE, tuples: MEMBER_OF_WS1 });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { workspaceId: 'ws-1', title: 'T', creatorId: 'victim' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().creatorId).toBe('alice');
  });

  it('POST /tasks — 403 for a non-member of the target workspace', async () => {
    const { app } = await buildApp({ user: BOB });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { workspaceId: 'ws-1', title: 'T' },
    });
    expect(res.statusCode).toBe(403);
  });
});
