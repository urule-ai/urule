import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authzMiddleware } from '@urule/authz-middleware';
import { createMockAuthzClient } from '@urule/authz/testing';
import type { RelationTuple } from '@urule/authz';
import { registerAgentRoutes } from '../../src/routes/agents.routes.js';
import { registerConversationRoutes } from '../../src/routes/conversations.routes.js';
import { registerProviderRoutes } from '../../src/routes/providers.routes.js';
import { registerRuntimeRoutes } from '../../src/routes/runtimes.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { agents } from '../../src/db/schema/agents.js';
import { conversations, conversationAgents, messages } from '../../src/db/schema/conversations.js';
import { providers } from '../../src/db/schema/providers.js';
import { runtimes } from '../../src/db/schema/runtimes.js';

/* ------------------------------------------------------------------ *
 * #4 — per-id resource READ routes were ungated: knowing a ULID let any
 * authenticated user read another workspace's agent / conversation /
 * provider / runtime by id (read-IDOR). They now resolve the resource's
 * workspace and require membership of it. This locks the gate on every
 * one of those routes. (`GET /providers/:id/key` keeps its own inline
 * admin gate — it's the service-caller path — and is not covered here.)
 * ------------------------------------------------------------------ */

type TestUser = { id: string; username?: string; roles?: string[] } | null;

const agentRow = { id: 'a1', workspaceId: 'ws-1', name: 'Ada', status: 'idle', config: {} };
const convRow = {
  id: 'c1', workspaceId: 'ws-1', title: 'T', type: 'direct',
  parentConversationId: null, branchedFromMessageId: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const providerRow = {
  id: 'p1', workspaceId: 'ws-1', name: 'OpenAI', provider: 'openai',
  modelName: 'gpt-4o', apiKey: 'sk-secret-key', baseUrl: '', isDefault: true, isActive: true,
};
const runtimeRow = { id: 'r1', workspaceId: 'ws-1', provider: 'docker', profile: 'default', status: 'available' };

/** Each resource table resolves to its single row (so both the membership
 *  resolver's workspace lookup AND the handler get what they expect); join
 *  tables resolve empty. */
function makeMockDb() {
  return {
    select: () => ({
      from: (table: unknown) => {
        const rows =
          table === agents ? [agentRow] :
          table === conversations ? [convRow] :
          table === providers ? [providerRow] :
          table === runtimes ? [runtimeRow] :
          (table === conversationAgents || table === messages) ? [] : [];
        return { where: () => Promise.resolve(rows) };
      },
    }),
  } as never;
}

async function buildApp(opts: { user: TestUser; tuples?: RelationTuple[] }): Promise<FastifyInstance> {
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

  const db = makeMockDb();
  registerAgentRoutes(app, db);
  registerConversationRoutes(app, db);
  registerProviderRoutes(app, db);
  registerRuntimeRoutes(app, db);
  await app.ready();
  return app;
}

const ALICE = { id: 'alice', username: 'alice' };
const BOB = { id: 'bob', username: 'bob' };
const ROOT = { id: 'root', username: 'root', roles: ['admin'] };
const MEMBER: RelationTuple[] = [{ user: 'user:alice', relation: 'member', object: 'workspace:ws-1' }];

// Every per-id read this PR gated. All resources live in ws-1.
const ALL_GATED = [
  '/api/v1/agents/a1',
  '/api/v1/agents/a1/metrics',
  '/api/v1/agents/a1/health',
  '/api/v1/agents/a1/conversations',
  '/api/v1/agents/a1/logs',
  '/api/v1/conversations/c1',
  '/api/v1/conversations/c1/messages',
  '/api/v1/conversations/c1/branches',
  '/api/v1/providers/p1',
  '/api/v1/runtimes/r1',
];

// Representative detail routes whose handlers are simple enough to assert a
// 200 on the allowed path (one per resolver type).
const SIMPLE = ['/api/v1/agents/a1', '/api/v1/conversations/c1', '/api/v1/providers/p1', '/api/v1/runtimes/r1'];

describe('per-id resource reads — membership gate (#4)', () => {
  it.each(ALL_GATED)('403 for a non-member: GET %s', async (url) => {
    const app = await buildApp({ user: BOB }); // no membership tuple
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it.each(ALL_GATED)('401 when unauthenticated: GET %s', async (url) => {
    const app = await buildApp({ user: null });
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(401);
  });

  it.each(SIMPLE)('200 for a workspace member: GET %s', async (url) => {
    const app = await buildApp({ user: ALICE, tuples: MEMBER });
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
  });

  it.each(SIMPLE)('200 for an admin (realm-role bypass): GET %s', async (url) => {
    const app = await buildApp({ user: ROOT });
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
  });

  it('does NOT gate GET /providers/:id/key here (keeps its inline admin gate)', async () => {
    // A member (non-admin) is still refused the unmasked key by the route's own
    // inline admin check — proving this PR didn't replace that stronger gate.
    const app = await buildApp({ user: ALICE, tuples: MEMBER });
    const res = await app.inject({ method: 'GET', url: '/api/v1/providers/p1/key' });
    expect(res.statusCode).toBe(403);
  });
});
