import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { authzMiddleware } from '@urule/authz-middleware';
import { createMockAuthzClient } from '@urule/authz/testing';
import type { RelationTuple } from '@urule/authz';
import { InMemoryInstallationRepo, type InstallationRecord } from '../src/services/installation-repo.js';
import { DependencyResolver } from '../src/services/dependency-resolver.js';
import { ManifestLoader } from '../src/services/manifest-loader.js';
import { PackageManager } from '../src/services/package-manager.js';
import { registerInstallationRoutes } from '../src/routes/installations.routes.js';
import { registerPackageRoutes } from '../src/routes/packages.routes.js';

/* ------------------------------------------------------------------ *
 * Phase D — requireMembership enforcement on the packages service.
 * Closes #4 case B (read/act on another workspace's installations).
 * A custom onRequest hook stands in for @urule/auth-middleware.
 * ------------------------------------------------------------------ */

type TestUser = { id: string; roles?: string[] } | null;

function installation(over: Partial<InstallationRecord> = {}): InstallationRecord {
  return {
    id: 'inst-1',
    workspaceId: 'ws-1',
    packageName: 'pkg',
    version: '1.0.0',
    type: 'widget',
    status: 'installed',
    config: {},
    installedAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

async function buildApp(opts: {
  user: TestUser;
  tuples?: RelationTuple[];
  seed?: InstallationRecord[];
}): Promise<{ app: FastifyInstance; repo: InMemoryInstallationRepo }> {
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

  const repo = new InMemoryInstallationRepo();
  for (const rec of opts.seed ?? []) await repo.insert(rec);

  const manager = new PackageManager(
    new DependencyResolver(),
    new ManifestLoader('/tmp/urule-packages-test', 'http://packagehub.invalid'),
    repo,
    'http://packagehub.invalid',
  );
  registerInstallationRoutes(app, manager, repo);
  registerPackageRoutes(app, manager, repo);
  await app.ready();
  return { app, repo };
}

const ALICE = { id: 'alice' };
const BOB = { id: 'bob' };
const ROOT = { id: 'root', roles: ['admin'] };
const MEMBER_OF_WS1: RelationTuple[] = [
  { user: 'user:alice', relation: 'member', object: 'workspace:ws-1' },
];

describe('Phase D — packages authz enforcement', () => {
  it('GET /workspaces/:wsId/packages — 403 for a non-member', async () => {
    const { app } = await buildApp({ user: BOB });
    const res = await app.inject({ method: 'GET', url: '/api/v1/workspaces/ws-1/packages' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('GET /workspaces/:wsId/packages — 200 for a workspace member', async () => {
    const { app } = await buildApp({
      user: ALICE,
      tuples: MEMBER_OF_WS1,
      seed: [installation()],
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/workspaces/ws-1/packages' });
    expect(res.statusCode).toBe(200);
    expect(res.json().packages).toHaveLength(1);
  });

  it('GET /workspaces/:wsId/packages — 200 for an `admin` user (bypass)', async () => {
    const { app } = await buildApp({ user: ROOT });
    const res = await app.inject({ method: 'GET', url: '/api/v1/workspaces/ws-1/packages' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /packages/:installId — 403 reading another workspace\'s installation', async () => {
    // #4 case B: bob is not a member of ws-1, where inst-1 lives.
    const { app } = await buildApp({ user: BOB, seed: [installation()] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/packages/inst-1' });
    expect(res.statusCode).toBe(403);
  });

  it('GET /packages/:installId — 404 for an unknown installation', async () => {
    const { app } = await buildApp({ user: ALICE, tuples: MEMBER_OF_WS1 });
    const res = await app.inject({ method: 'GET', url: '/api/v1/packages/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('POST /packages/install — 403 for a non-member of the target workspace', async () => {
    const { app } = await buildApp({ user: BOB });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/install',
      payload: { workspaceId: 'ws-1', packageName: 'some-pkg' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /packages/:installId — 403 for a non-member', async () => {
    const { app } = await buildApp({ user: BOB, seed: [installation()] });
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/packages/inst-1' });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /packages/:installId — 204 for a workspace member', async () => {
    const { app, repo } = await buildApp({
      user: ALICE,
      tuples: MEMBER_OF_WS1,
      seed: [installation()],
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/packages/inst-1' });
    expect(res.statusCode).toBe(204);
    expect(await repo.getById('inst-1')).toBeUndefined();
  });
});
