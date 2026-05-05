import { describe, it, expect } from 'vitest';
import { PackageManager, compareVersions } from '../src/services/package-manager.js';
import { DependencyResolver } from '../src/services/dependency-resolver.js';
import type { ManifestLoader } from '../src/services/manifest-loader.js';
import { InMemoryInstallationRepo } from '../src/services/installation-repo.js';

const noopLoader = {} as ManifestLoader;

function stubFetch(versionsByPackage: Record<string, Array<{ version: string; yanked?: boolean; publishedAt?: string }>>) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input: unknown) => {
    const url = String(input);
    // Match /api/v1/packages/<name>/versions
    const m = url.match(/\/api\/v1\/packages\/([^/?]+)\/versions/);
    if (m) {
      const name = decodeURIComponent(m[1]!);
      const list = versionsByPackage[name];
      if (!list) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(list), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // Entitlement endpoint — always allow so the entitlement gate doesn't
    // interfere with these tests.
    if (url.includes('/api/v1/entitlements')) {
      return new Response(JSON.stringify({ allowed: true, reason: 'free' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('unhandled', { status: 500 });
  };
  return () => { globalThis.fetch = real; };
}

describe('compareVersions (semver-ish floor)', () => {
  it('orders core segments numerically', () => {
    expect(compareVersions('1.0.0', '1.0.1') < 0).toBe(true);
    expect(compareVersions('1.10.0', '1.9.0') > 0).toBe(true);   // numeric, not lex
    expect(compareVersions('2.0.0', '1.99.99') > 0).toBe(true);
  });

  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('treats pre-release as lower than the base', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0') < 0).toBe(true);
    expect(compareVersions('1.0.0', '1.0.0-rc.1') > 0).toBe(true);
  });

  it('compares pre-release tags lexicographically', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.2') < 0).toBe(true);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta') < 0).toBe(true);
  });

  it('handles missing patch as 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1') < 0).toBe(true);
  });
});

describe('PackageManager.checkUpdates', () => {
  it('returns empty when there are no installations', async () => {
    const restore = stubFetch({});
    try {
      const mgr = new PackageManager(new DependencyResolver(), noopLoader, new InMemoryInstallationRepo(), 'http://packagehub.test');
      expect(await mgr.checkUpdates('ws-1')).toEqual([]);
    } finally {
      restore();
    }
  });

  it('returns empty when installed === latest', async () => {
    const restore = stubFetch({
      'pkg-a': [{ version: '1.0.0', publishedAt: '2026-01-01T00:00:00Z' }],
    });
    try {
      const mgr = new PackageManager(new DependencyResolver(), noopLoader, new InMemoryInstallationRepo(), 'http://packagehub.test');
      await mgr.injectInstallationForTest({
        id: 'i1', workspaceId: 'ws-1', packageName: 'pkg-a',
        version: '1.0.0', type: 'personality', status: 'installed',
        installedAt: new Date().toISOString(), config: {},
      });
      expect(await mgr.checkUpdates('ws-1')).toEqual([]);
    } finally {
      restore();
    }
  });

  it('flags an outdated installation when packagehub has a newer version', async () => {
    const restore = stubFetch({
      'pkg-a': [
        { version: '2.0.0', publishedAt: '2026-05-01T00:00:00Z' },
        { version: '1.0.0', publishedAt: '2026-01-01T00:00:00Z' },
      ],
    });
    try {
      const mgr = new PackageManager(new DependencyResolver(), noopLoader, new InMemoryInstallationRepo(), 'http://packagehub.test');
      await mgr.injectInstallationForTest({
        id: 'i1', workspaceId: 'ws-1', packageName: 'pkg-a',
        version: '1.0.0', type: 'personality', status: 'installed',
        installedAt: new Date().toISOString(), config: {},
      });
      const updates = await mgr.checkUpdates('ws-1');
      expect(updates).toEqual([{
        installationId: 'i1', packageName: 'pkg-a',
        installedVersion: '1.0.0', latestVersion: '2.0.0',
      }]);
    } finally {
      restore();
    }
  });

  it('skips yanked latest and falls back to the next non-yanked version', async () => {
    const restore = stubFetch({
      'pkg-a': [
        { version: '2.0.0', yanked: true, publishedAt: '2026-05-01T00:00:00Z' },
        { version: '1.5.0', publishedAt: '2026-04-01T00:00:00Z' },
      ],
    });
    try {
      const mgr = new PackageManager(new DependencyResolver(), noopLoader, new InMemoryInstallationRepo(), 'http://packagehub.test');
      await mgr.injectInstallationForTest({
        id: 'i1', workspaceId: 'ws-1', packageName: 'pkg-a',
        version: '1.0.0', type: 'personality', status: 'installed',
        installedAt: new Date().toISOString(), config: {},
      });
      const updates = await mgr.checkUpdates('ws-1');
      expect(updates[0]?.latestVersion).toBe('1.5.0');
    } finally {
      restore();
    }
  });

  it('does not return downgrades (installed > latest published)', async () => {
    const restore = stubFetch({
      'pkg-a': [{ version: '1.0.0', publishedAt: '2026-01-01T00:00:00Z' }],
    });
    try {
      const mgr = new PackageManager(new DependencyResolver(), noopLoader, new InMemoryInstallationRepo(), 'http://packagehub.test');
      await mgr.injectInstallationForTest({
        id: 'i1', workspaceId: 'ws-1', packageName: 'pkg-a',
        version: '2.0.0', type: 'personality', status: 'installed',
        installedAt: new Date().toISOString(), config: {},
      });
      expect(await mgr.checkUpdates('ws-1')).toEqual([]);
    } finally {
      restore();
    }
  });

  it('survives transient packagehub failures (returns empty for that pkg)', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
      const mgr = new PackageManager(new DependencyResolver(), noopLoader, new InMemoryInstallationRepo(), 'http://packagehub.test');
      await mgr.injectInstallationForTest({
        id: 'i1', workspaceId: 'ws-1', packageName: 'pkg-a',
        version: '1.0.0', type: 'personality', status: 'installed',
        installedAt: new Date().toISOString(), config: {},
      });
      expect(await mgr.checkUpdates('ws-1')).toEqual([]);
    } finally {
      globalThis.fetch = real;
    }
  });

  it('only inspects installations with status="installed"', async () => {
    const restore = stubFetch({
      'pkg-a': [{ version: '2.0.0', publishedAt: '2026-05-01T00:00:00Z' }],
    });
    try {
      const mgr = new PackageManager(new DependencyResolver(), noopLoader, new InMemoryInstallationRepo(), 'http://packagehub.test');
      await mgr.injectInstallationForTest({
        id: 'i1', workspaceId: 'ws-1', packageName: 'pkg-a',
        version: '1.0.0', type: 'personality', status: 'failed',
        installedAt: new Date().toISOString(), config: {},
      });
      expect(await mgr.checkUpdates('ws-1')).toEqual([]);
    } finally {
      restore();
    }
  });
});
