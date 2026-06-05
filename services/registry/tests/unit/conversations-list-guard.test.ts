import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authzMiddleware } from '@urule/authz-middleware';
import { createMockAuthzClient } from '@urule/authz/testing';
import type { RelationTuple } from '@urule/authz';
import { registerConversationRoutes } from '../../src/routes/conversations.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { conversations, conversationAgents, messages } from '../../src/db/schema/conversations.js';
import { agents } from '../../src/db/schema/agents.js';

/* ------------------------------------------------------------------ *
 * #4 / #95 follow-up — the office-ui chat + meetings lists were calling
 * the admin-only cross-workspace `GET /api/v1/conversations` (403 for
 * non-admins). They now hit the workspace-scoped
 * `GET /api/v1/workspaces/:wsId/conversations`, which must be
 * MEMBERSHIP-gated (not open) so it can't enumerate other workspaces.
 * This locks the gate + the decorated response shape.
 * A custom onRequest hook stands in for @urule/auth-middleware so each
 * test picks the request's user; OpenFGA membership comes from a mock.
 * ------------------------------------------------------------------ */

type TestUser = { id: string; username?: string; roles?: string[] } | null;

/** Drizzle-ish mock covering the scoped-list query + its decoration joins. */
function makeMockDb(opts: { conversations?: unknown[]; lastMsg?: unknown; count?: number } = {}) {
  const convs = opts.conversations ?? [];
  return {
    select: (sel?: unknown) => ({
      from: (table: unknown) => {
        if (table === conversations) {
          return { where: () => ({ orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve(convs) }) }) }) };
        }
        if (table === conversationAgents) {
          return { where: () => Promise.resolve([]) }; // no linked agents in these fixtures
        }
        if (table === messages) {
          return sel
            ? { where: () => Promise.resolve([{ count: opts.count ?? 0 }]) } // count projection
            : { where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(opts.lastMsg ? [opts.lastMsg] : []) }) }) };
        }
        if (table === agents) {
          return { where: () => Promise.resolve([]) };
        }
        return { where: () => Promise.resolve([]) };
      },
    }),
  } as never;
}

async function buildApp(opts: {
  user: TestUser;
  tuples?: RelationTuple[];
  db?: ReturnType<typeof makeMockDb>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorateRequest('uruleUser', null);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { uruleUser: TestUser }).uruleUser = opts.user;
  });

  const authz = createMockAuthzClient();
  if (opts.tuples) await authz.writeTuples(opts.tuples);
  await app.register(authzMiddleware, { authzClient: authz });
  app.setErrorHandler(errorHandler);

  registerConversationRoutes(app, opts.db ?? makeMockDb());
  await app.ready();
  return app;
}

const ALICE = { id: 'alice', username: 'alice' };
const BOB = { id: 'bob', username: 'bob' };
const ROOT = { id: 'root', username: 'root', roles: ['admin'] };
const URL = '/api/v1/workspaces/ws-1/conversations';

describe('GET /api/v1/workspaces/:wsId/conversations — membership gate (#4/#95)', () => {
  it('403 for a non-member of the workspace', async () => {
    const app = await buildApp({ user: BOB }); // no membership tuple
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('401 when there is no authenticated user', async () => {
    const app = await buildApp({ user: null });
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(401);
  });

  it('200 (empty list) for a workspace member', async () => {
    const app = await buildApp({
      user: ALICE,
      tuples: [{ user: 'user:alice', relation: 'member', object: 'workspace:ws-1' }],
    });
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('200 for an `admin` user even with no membership tuple (realm-role bypass)', async () => {
    const app = await buildApp({ user: ROOT });
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
  });

  it('returns the decorated chat-list shape (agents, message_count, last_message)', async () => {
    const convRow = {
      id: 'c1', workspaceId: 'ws-1', title: 'Standup', type: 'meeting',
      parentConversationId: null, branchedFromMessageId: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const app = await buildApp({
      user: ALICE,
      tuples: [{ user: 'user:alice', relation: 'member', object: 'workspace:ws-1' }],
      db: makeMockDb({ conversations: [convRow], count: 3 }),
    });
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('c1');
    expect(body[0].workspace_id).toBe('ws-1');
    expect(body[0].agents).toEqual([]);
    expect(body[0].message_count).toBe(3);
    expect(body[0].last_message).toBeNull();
  });
});
