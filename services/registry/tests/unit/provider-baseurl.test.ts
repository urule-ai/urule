import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authzMiddleware } from '@urule/authz-middleware';
import { createMockAuthzClient } from '@urule/authz/testing';
import { registerProviderRoutes, getBaseUrlIssue } from '../../src/routes/providers.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';

/* ------------------------------------------------------------------ *
 * #6 (C-06) — provider baseUrl egress validation.
 *
 * The PATCH/POST routes are already authz-gated (requireMembership), but
 * a member could still redirect LLM egress by setting `baseUrl` to an
 * attacker host — exfiltrating the API key + every chat payload. These
 * tests cover the `getBaseUrlIssue` allow-list/SSRF policy directly, plus
 * the route wiring for the admin-gate and the metadata hard-stop.
 * ------------------------------------------------------------------ */

describe('getBaseUrlIssue — allow-list + SSRF policy (#6)', () => {
  it('accepts an empty / unset baseUrl (adapter uses the default hosted endpoint)', () => {
    expect(getBaseUrlIssue({ provider: 'openai', baseUrl: '', isAdmin: false })).toBeNull();
    expect(getBaseUrlIssue({ provider: 'openai', baseUrl: '   ', isAdmin: false })).toBeNull();
    expect(getBaseUrlIssue({ provider: 'openai', isAdmin: false })).toBeNull();
  });

  it('accepts the recognised hosted endpoint for any member (non-admin)', () => {
    expect(getBaseUrlIssue({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', isAdmin: false })).toBeNull();
    expect(getBaseUrlIssue({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', isAdmin: false })).toBeNull();
    expect(getBaseUrlIssue({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', isAdmin: false })).toBeNull();
    expect(getBaseUrlIssue({ provider: 'azure', baseUrl: 'https://my-resource.openai.azure.com/', isAdmin: false })).toBeNull();
  });

  it('rejects a non-admin pointing a provider at a non-allow-listed (attacker) host — the core C-06 fix', () => {
    const issue = getBaseUrlIssue({ provider: 'openai', baseUrl: 'https://evil.example.com/v1', isAdmin: false });
    expect(issue?.status).toBe(403);
    expect(issue?.message).toMatch(/admin role/);
  });

  it('rejects a look-alike host that does not exactly match the allow-list', () => {
    // `api.openai.com.evil.com` parses to that full hostname — must NOT match `api.openai.com`.
    const issue = getBaseUrlIssue({ provider: 'openai', baseUrl: 'https://api.openai.com.evil.com/v1', isAdmin: false });
    expect(issue?.status).toBe(403);
  });

  it('lets an admin register a self-hosted endpoint (Ollama / vLLM)', () => {
    expect(getBaseUrlIssue({ provider: 'openai', baseUrl: 'http://localhost:11434/v1', isAdmin: true })).toBeNull();
    expect(getBaseUrlIssue({ provider: 'openai', baseUrl: 'http://10.0.0.5:8000/v1', isAdmin: true })).toBeNull();
    expect(getBaseUrlIssue({ provider: 'openai', baseUrl: 'https://llm.corp.example.com/v1', isAdmin: true })).toBeNull();
  });

  it('blocks link-local / cloud-metadata even for an admin (SSRF hard-stop)', () => {
    for (const host of [
      'http://169.254.169.254/latest/meta-data/',     // AWS/GCP/Azure IMDS
      'http://[fe80::1]/v1',                            // IPv6 link-local
      'https://metadata.google.internal/computeMetadata/v1/',
      'http://[::ffff:169.254.169.254]/latest/',        // IPv4-mapped IPv6 (dotted)
      'http://[::ffff:a9fe:a9fe]/latest/',              // IPv4-mapped IPv6 (hex) → 169.254.169.254
      'http://0.0.0.0:8000/v1',                         // unspecified IPv4
      'http://[::]/v1',                                 // unspecified IPv6
    ]) {
      const issue = getBaseUrlIssue({ provider: 'openai', baseUrl: host, isAdmin: true });
      expect(issue?.status, host).toBe(400);
      expect(issue?.message, host).toMatch(/link-local or cloud-metadata/);
    }
  });

  it('treats a trailing-dot FQDN of a hosted endpoint as the endpoint (not a custom host)', () => {
    // `api.openai.com.` resolves to the same host — a non-admin should be allowed,
    // and it must not be a way to dodge the exact-host allow-list.
    expect(getBaseUrlIssue({ provider: 'openai', baseUrl: 'https://api.openai.com./v1', isAdmin: false })).toBeNull();
  });

  it('rejects non-http(s) schemes (file:, gopher:, …) — even for admins', () => {
    expect(getBaseUrlIssue({ provider: 'openai', baseUrl: 'file:///etc/passwd', isAdmin: true })?.status).toBe(400);
    expect(getBaseUrlIssue({ provider: 'openai', baseUrl: 'gopher://127.0.0.1:6379/_INFO', isAdmin: true })?.status).toBe(400);
  });

  it('rejects embedded credentials (cred smuggling / allow-list bypass)', () => {
    // hostname is evil.com; the `api.openai.com` is the username — must be rejected.
    const issue = getBaseUrlIssue({ provider: 'openai', baseUrl: 'https://api.openai.com@evil.com/v1', isAdmin: false });
    expect(issue?.status).toBe(400);
    expect(issue?.message).toMatch(/embedded credentials/);
  });

  it('rejects plaintext downgrade of a recognised hosted endpoint', () => {
    const issue = getBaseUrlIssue({ provider: 'openai', baseUrl: 'http://api.openai.com/v1', isAdmin: true });
    expect(issue?.status).toBe(400);
    expect(issue?.message).toMatch(/https/);
  });

  it('rejects a malformed URL', () => {
    expect(getBaseUrlIssue({ provider: 'openai', baseUrl: 'not a url', isAdmin: true })?.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ *
 * Route-level wiring — proves the helper is enforced on POST/PATCH for
 * both admin and ordinary (membership-tuple) members.
 * ------------------------------------------------------------------ */

function makeMockDb({
  existingProvider,
  updateReturns,
  insertReturns,
}: {
  existingProvider?: Record<string, unknown>;
  updateReturns?: Record<string, unknown>[];
  insertReturns?: Record<string, unknown>[];
} = {}) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([{ id: 'ws-1' }])),
        where: vi.fn(() => Promise.resolve(existingProvider ? [existingProvider] : [])),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(insertReturns ?? [])) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(updateReturns ?? [])) })),
      })),
    })),
  };
}

type TestUser = { id: string; roles: string[] };

async function buildApp(
  db = makeMockDb(),
  user: TestUser = { id: 'test-admin', roles: ['admin'] },
  authz = createMockAuthzClient(),
) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('uruleUser', null);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { uruleUser: TestUser }).uruleUser = user;
  });
  await app.register(authzMiddleware, { authzClient: authz });
  app.setErrorHandler(errorHandler);
  registerProviderRoutes(app, db as never);
  return app;
}

describe('provider routes — baseUrl enforcement (#6)', () => {
  it('PATCH: a non-admin member cannot redirect egress to an attacker host (403)', async () => {
    const authz = createMockAuthzClient();
    // The member legitimately belongs to the workspace — so membership passes
    // and the baseUrl admin-gate is what rejects, not the authz preHandler.
    await authz.writeTuples([{ user: 'user:u-member', relation: 'member', object: 'workspace:ws-1' }]);
    const app = await buildApp(
      makeMockDb({ existingProvider: { id: '01PROVIDER', workspaceId: 'ws-1', provider: 'openai', apiKey: 'sk-existing', baseUrl: '' } }),
      { id: 'u-member', roles: ['member'] },
      authz,
    );

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/providers/01PROVIDER',
      payload: { baseUrl: 'https://evil.example.com/v1' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('PATCH: a non-admin member CAN still point at the recognised hosted endpoint (200)', async () => {
    const authz = createMockAuthzClient();
    await authz.writeTuples([{ user: 'user:u-member', relation: 'member', object: 'workspace:ws-1' }]);
    const updated = { id: '01PROVIDER', workspaceId: 'ws-1', provider: 'openai', apiKey: 'sk-x', baseUrl: 'https://api.openai.com', isDefault: false, isActive: true };
    const app = await buildApp(
      makeMockDb({ existingProvider: { id: '01PROVIDER', workspaceId: 'ws-1', provider: 'openai', apiKey: 'sk-x', baseUrl: '' }, updateReturns: [updated] }),
      { id: 'u-member', roles: ['member'] },
      authz,
    );

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/providers/01PROVIDER',
      payload: { baseUrl: 'https://api.openai.com' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('PATCH: an admin cannot point egress at the cloud-metadata endpoint (400)', async () => {
    const app = await buildApp(
      makeMockDb({ existingProvider: { id: '01PROVIDER', workspaceId: 'ws-1', provider: 'openai', apiKey: 'sk-x', baseUrl: '' } }),
      { id: 'admin-1', roles: ['admin'] },
    );

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/providers/01PROVIDER',
      payload: { baseUrl: 'http://169.254.169.254/latest/meta-data/' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Validation failed');
  });

  it('POST: a non-admin member cannot create a provider with a self-hosted baseUrl (403)', async () => {
    const authz = createMockAuthzClient();
    await authz.writeTuples([{ user: 'user:u-member', relation: 'member', object: 'workspace:ws-1' }]);
    const app = await buildApp(makeMockDb(), { id: 'u-member', roles: ['member'] }, authz);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: { workspaceId: 'ws-1', name: 'Local', provider: 'openai', apiKey: 'sk-test', baseUrl: 'http://localhost:11434/v1' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('POST: an admin CAN create a provider with a self-hosted baseUrl (201)', async () => {
    const inserted = { id: '01LOCAL', workspaceId: 'ws-1', name: 'Local', provider: 'openai', modelName: '', apiKey: 'sk-test', baseUrl: 'http://localhost:11434/v1', isDefault: false, isActive: true };
    const app = await buildApp(makeMockDb({ insertReturns: [inserted] }), { id: 'admin-1', roles: ['admin'] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: { workspaceId: 'ws-1', name: 'Local', provider: 'openai', apiKey: 'sk-test', baseUrl: 'http://localhost:11434/v1' },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).base_url).toBe('http://localhost:11434/v1');
  });
});
