import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { authMiddleware } from '@urule/auth-middleware';
import { correlationIdPlugin } from '@urule/correlation-id';
import { DependencyResolver } from '../src/services/dependency-resolver.js';
import { InMemoryInstallationRepo } from '../src/services/installation-repo.js';
import { PackageManager } from '../src/services/package-manager.js';
import type { ManifestLoader } from '../src/services/manifest-loader.js';
import type { PackageManifest } from '../src/types.js';
import { registerInstallationRoutes } from '../src/routes/installations.routes.js';
import { registerPackageRoutes } from '../src/routes/packages.routes.js';

/**
 * HTTP-integration tests for the install / uninstall / entitlement gate flow.
 *
 * Architecture: builds a Fastify app inline (Option A — same pattern as
 * `auth-401.test.ts`) rather than calling `buildServer`. `buildServer`
 * always wires `DrizzleInstallationRepo` against a real Postgres URL,
 * which CI deliberately doesn't run (see `installation-repo.ts` header
 * comment). Inline app + `InMemoryInstallationRepo` keeps the test
 * hermetic; we still exercise correlation-id → auth → routes → manager
 * → manifest-loader end-to-end.
 */

function makeLoader(manifestByVersion: Record<string, PackageManifest>): ManifestLoader {
  return {
    loadFromGitHub: async () => { throw new Error('not used'); },
    loadFromPath: async () => { throw new Error('not used'); },
    loadFromPackagehub: async (_name: string, version?: string) => {
      const v = version ?? Object.keys(manifestByVersion)[0]!;
      const m = manifestByVersion[v];
      if (!m) throw new Error(`No manifest for version ${v}`);
      return m;
    },
  } as unknown as ManifestLoader;
}

interface TestApp {
  app: FastifyInstance;
  manager: PackageManager;
  repo: InMemoryInstallationRepo;
}

async function buildTestApp(opts: {
  manifestMap: Record<string, PackageManifest>;
  packagehubUrl?: string;
}): Promise<TestApp> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Mirror server.ts: map Zod validation failures back to the historical shape.
  app.setErrorHandler((err, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: err.validation,
      });
    }
    reply.send(err);
  });

  await app.register(correlationIdPlugin);
  await app.register(authMiddleware, { skipAuth: true });

  const repo = new InMemoryInstallationRepo();
  const loader = makeLoader(opts.manifestMap);
  const manager = new PackageManager(
    new DependencyResolver(),
    loader,
    repo,
    opts.packagehubUrl ?? 'http://packagehub.test',
  );

  registerInstallationRoutes(app, manager);
  registerPackageRoutes(app, manager);

  await app.ready();
  return { app, manager, repo };
}

/** Build a fetch stub that routes by URL substring. */
function stubEntitlementFetch(handler: (url: string) => Response | Promise<Response> | never) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url);
  }));
}

describe('packages — entitlement / install / uninstall HTTP flow', () => {
  let testApp: TestApp | undefined;

  beforeEach(() => {
    // Each test installs its own fetch stub via vi.stubGlobal.
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (testApp) {
      await testApp.app.close();
      testApp = undefined;
    }
  });

  it('1. free package install — happy path returns 201 and a retrievable row', async () => {
    stubEntitlementFetch(() =>
      new Response(JSON.stringify({ allowed: true, reason: 'free' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    testApp = await buildTestApp({
      manifestMap: {
        '1.0.0': { name: 'free-pkg', version: '1.0.0', type: 'personality', description: '' },
      },
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/packages/install',
      payload: { workspaceId: 'ws-1', packageName: 'free-pkg' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.workspaceId).toBe('ws-1');
    expect(body.packageName).toBe('free-pkg');
    expect(body.version).toBe('1.0.0');
    expect(body.status).toBe('installed');

    // Verify the install row is retrievable.
    const getRes = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/packages/${body.id}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().id).toBe(body.id);
  });

  it('2. paid package without entitlement returns 402 ENTITLEMENT_REQUIRED with paymentLink', async () => {
    stubEntitlementFetch(() =>
      new Response(JSON.stringify({
        allowed: false,
        reason: 'requires_purchase',
        licenseTier: 'paid',
        priceCents: 999,
        paymentLink: 'https://example.test/checkout/paid-pkg',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    testApp = await buildTestApp({
      manifestMap: {
        '1.0.0': { name: 'paid-pkg', version: '1.0.0', type: 'skill', description: '' },
      },
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/packages/install',
      payload: { workspaceId: 'ws-1', packageName: 'paid-pkg' },
    });

    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.error).toMatchObject({
      code: 'ENTITLEMENT_REQUIRED',
      message: expect.any(String),
    });
    expect(body.packageName).toBe('paid-pkg');
    expect(body.licenseTier).toBe('paid');
    expect(body.priceCents).toBe(999);
    expect(body.paymentLink).toBe('https://example.test/checkout/paid-pkg');
  });

  it('3. paid package WITH entitlement returns 201 and creates the install row', async () => {
    stubEntitlementFetch(() =>
      new Response(JSON.stringify({ allowed: true, reason: 'entitled' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    testApp = await buildTestApp({
      manifestMap: {
        '2.0.0': { name: 'paid-pkg', version: '2.0.0', type: 'skill', description: '' },
      },
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/packages/install',
      payload: { workspaceId: 'ws-1', packageName: 'paid-pkg' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('installed');
    expect(body.version).toBe('2.0.0');
    expect(body.packageName).toBe('paid-pkg');
  });

  it('4. packagehub unreachable during entitlement check — install proceeds, then loader failure surfaces as 409', async () => {
    // fetch THROWS (network error like ECONNREFUSED) — this is the only
    // path that satisfies the "transient outage doesn't block install"
    // contract per package-manager.ts:checkEntitlement (a 5xx response
    // would itself throw and surface as 409 with an entitlement-flavored
    // message instead).
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));

    // Empty manifest map — loader will throw "No manifest for version ..."
    // proving install proceeded past the (silently swallowed) entitlement
    // check and only failed when the manifest layer kicked in.
    testApp = await buildTestApp({ manifestMap: {} });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/packages/install',
      payload: { workspaceId: 'ws-1', packageName: 'some-pkg' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    // Failure originates from the manifest loader, NOT the entitlement
    // gate — confirms the entitlement-check transient failure was
    // swallowed rather than surfaced as 402.
    expect(body.error).toContain('No manifest');
  });

  it('5. uninstall happy path — DELETE returns 204 and the row is gone', async () => {
    stubEntitlementFetch(() =>
      new Response(JSON.stringify({ allowed: true, reason: 'free' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    testApp = await buildTestApp({
      manifestMap: {
        '1.0.0': { name: 'free-pkg', version: '1.0.0', type: 'personality', description: '' },
      },
    });

    const installRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/packages/install',
      payload: { workspaceId: 'ws-1', packageName: 'free-pkg' },
    });
    expect(installRes.statusCode).toBe(201);
    const installId = installRes.json().id;

    const delRes = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/v1/packages/${installId}`,
    });
    expect(delRes.statusCode).toBe(204);

    const getRes = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/packages/${installId}`,
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('6. uninstall unknown id returns 404 with a not-found message', async () => {
    testApp = await buildTestApp({ manifestMap: {} });

    const res = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/v1/packages/01HXXXXXXXXXXXXXXXXXXXXXXX',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(typeof body.error).toBe('string');
    expect(body.error).toMatch(/not found/i);
  });

  it('7. concurrent install of the same package — both succeed with distinct ids', async () => {
    stubEntitlementFetch(() =>
      new Response(JSON.stringify({ allowed: true, reason: 'free' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    testApp = await buildTestApp({
      manifestMap: {
        '1.0.0': { name: 'free-pkg', version: '1.0.0', type: 'personality', description: '' },
      },
    });

    const [resA, resB] = await Promise.all([
      testApp.app.inject({
        method: 'POST',
        url: '/api/v1/packages/install',
        payload: { workspaceId: 'ws-1', packageName: 'free-pkg' },
      }),
      testApp.app.inject({
        method: 'POST',
        url: '/api/v1/packages/install',
        payload: { workspaceId: 'ws-1', packageName: 'free-pkg' },
      }),
    ]);

    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);
    const a = resA.json();
    const b = resB.json();
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it('8. GET /api/v1/packages/:installId for unknown id returns 404', async () => {
    testApp = await buildTestApp({ manifestMap: {} });

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/packages/some-unknown-id',
    });

    expect(res.statusCode).toBe(404);
  });
});
