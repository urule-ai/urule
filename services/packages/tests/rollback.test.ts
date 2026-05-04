import { describe, it, expect } from 'vitest';
import { PackageManager, EntitlementRequiredError } from '../src/services/package-manager.js';
import { DependencyResolver } from '../src/services/dependency-resolver.js';
import type { ManifestLoader } from '../src/services/manifest-loader.js';
import type { PackageManifest } from '../src/types.js';

function makeLoader(manifestByVersion: Record<string, PackageManifest>): ManifestLoader {
  return {
    loadFromGitHub: async () => { throw new Error('not used'); },
    loadFromPath: async () => { throw new Error('not used'); },
    loadFromPackagehub: async (_name: string, version?: string) => {
      const v = version ?? Object.keys(manifestByVersion)[0]!;
      const m = manifestByVersion[v];
      if (!m) throw new Error(`No manifest for ${v}`);
      return m;
    },
  } as unknown as ManifestLoader;
}

function makeManager(loader: ManifestLoader, packagehubUrl = 'http://packagehub.test') {
  return new PackageManager(new DependencyResolver(), loader, packagehubUrl);
}

// Stub fetch to always return `allowed: true, reason: 'free'` so the
// entitlement gate doesn't block the rollback tests.
function stubAllowFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ allowed: true, reason: 'free' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  return () => { globalThis.fetch = real; };
}

describe('PackageManager — rollback', () => {
  it('returns 404 (NO_HISTORY) when no prior version exists', async () => {
    const restore = stubAllowFetch();
    try {
      const mgr = makeManager(makeLoader({
        '1.0.0': { name: 'pkg', version: '1.0.0', type: 'personality', description: '' },
      }));
      const inst = await mgr.install({ workspaceId: 'ws-1', packageName: 'pkg' });
      await expect(mgr.rollback(inst.id)).rejects.toMatchObject({
        message: expect.stringContaining('No prior version'),
      });
    } finally {
      restore();
    }
  });

  it('rolls back to the previous version after upgrade', async () => {
    const restore = stubAllowFetch();
    try {
      const mgr = makeManager(makeLoader({
        '1.0.0': { name: 'pkg', version: '1.0.0', type: 'personality', description: '' },
        '2.0.0': { name: 'pkg', version: '2.0.0', type: 'personality', description: '' },
      }));
      const inst = await mgr.install({ workspaceId: 'ws-1', packageName: 'pkg', version: '1.0.0' });
      await mgr.upgrade(inst.id, '2.0.0');
      const rolled = await mgr.rollback(inst.id);
      expect(rolled.version).toBe('1.0.0');
    } finally {
      restore();
    }
  });

  it('refuses a second rollback past the initial install', async () => {
    const restore = stubAllowFetch();
    try {
      const mgr = makeManager(makeLoader({
        '1.0.0': { name: 'pkg', version: '1.0.0', type: 'personality', description: '' },
        '2.0.0': { name: 'pkg', version: '2.0.0', type: 'personality', description: '' },
      }));
      const inst = await mgr.install({ workspaceId: 'ws-1', packageName: 'pkg', version: '1.0.0' });
      await mgr.upgrade(inst.id, '2.0.0');
      await mgr.rollback(inst.id);
      await expect(mgr.rollback(inst.id)).rejects.toMatchObject({
        message: expect.stringContaining('No prior version'),
      });
    } finally {
      restore();
    }
  });

  it('rollback through 3 versions returns each prior step', async () => {
    const restore = stubAllowFetch();
    try {
      const mgr = makeManager(makeLoader({
        '1.0.0': { name: 'pkg', version: '1.0.0', type: 'personality', description: '' },
        '2.0.0': { name: 'pkg', version: '2.0.0', type: 'personality', description: '' },
        '3.0.0': { name: 'pkg', version: '3.0.0', type: 'personality', description: '' },
      }));
      const inst = await mgr.install({ workspaceId: 'ws-1', packageName: 'pkg', version: '1.0.0' });
      await mgr.upgrade(inst.id, '2.0.0');
      await mgr.upgrade(inst.id, '3.0.0');
      const r1 = await mgr.rollback(inst.id);
      expect(r1.version).toBe('2.0.0');
      const r2 = await mgr.rollback(inst.id);
      expect(r2.version).toBe('1.0.0');
      await expect(mgr.rollback(inst.id)).rejects.toMatchObject({
        message: expect.stringContaining('No prior version'),
      });
    } finally {
      restore();
    }
  });
});

describe('PackageManager — entitlement gate', () => {
  it('throws EntitlementRequiredError when packagehub denies install', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({
        allowed: false,
        reason: 'requires_purchase',
        licenseTier: 'paid',
        priceCents: 999,
        paymentLink: 'https://example.test/checkout/pkg',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    try {
      const mgr = makeManager(makeLoader({
        '1.0.0': { name: 'paid-pkg', version: '1.0.0', type: 'skill', description: '' },
      }));
      await expect(
        mgr.install({ workspaceId: 'ws-1', packageName: 'paid-pkg' }),
      ).rejects.toBeInstanceOf(EntitlementRequiredError);
    } finally {
      globalThis.fetch = real;
    }
  });

  it('proceeds when packagehub allows (free or entitled)', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ allowed: true, reason: 'entitled' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    try {
      const mgr = makeManager(makeLoader({
        '1.0.0': { name: 'pkg', version: '1.0.0', type: 'personality', description: '' },
      }));
      const inst = await mgr.install({ workspaceId: 'ws-1', packageName: 'pkg' });
      expect(inst.status).toBe('installed');
      expect(inst.version).toBe('1.0.0');
    } finally {
      globalThis.fetch = real;
    }
  });

  it('does not block install when packagehub is unreachable (transient)', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
      const mgr = makeManager(makeLoader({
        '1.0.0': { name: 'pkg', version: '1.0.0', type: 'personality', description: '' },
      }));
      const inst = await mgr.install({ workspaceId: 'ws-1', packageName: 'pkg' });
      expect(inst.status).toBe('installed');
    } finally {
      globalThis.fetch = real;
    }
  });
});
