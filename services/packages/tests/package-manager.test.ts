import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PackageManager } from '../src/services/package-manager.js';
import { DependencyResolver } from '../src/services/dependency-resolver.js';
import { ManifestLoader } from '../src/services/manifest-loader.js';
import type { PackageManifest } from '../src/types.js';
import { InMemoryInstallationRepo } from '../src/services/installation-repo.js';

// Stub fetch so the entitlement gate inside install() always returns
// allowed: true — keeps these unit tests focused on lifecycle behaviour
// rather than entitlement plumbing (which has its own tests).
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ allowed: true, reason: 'free' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  return () => { globalThis.fetch = realFetch; };
});

const mockManifest: PackageManifest = {
  name: 'test-agent',
  version: '1.0.0',
  type: 'agent',
  description: 'A test agent package',
};

const mockManifestV2: PackageManifest = {
  name: 'test-agent',
  version: '2.0.0',
  type: 'agent',
  description: 'A test agent package v2',
};

describe('PackageManager', () => {
  let manager: PackageManager;
  let resolver: DependencyResolver;
  let loader: ManifestLoader;

  beforeEach(() => {
    resolver = new DependencyResolver();
    loader = new ManifestLoader('/tmp/test-work', 'http://localhost:3002');
    manager = new PackageManager(resolver, loader, new InMemoryInstallationRepo(), 'http://packagehub.test');

    // Mock the loader methods
    vi.spyOn(loader, 'loadFromPackagehub').mockResolvedValue(mockManifest);
    vi.spyOn(loader, 'loadFromGitHub').mockResolvedValue(mockManifest);
    vi.spyOn(loader, 'loadFromPath').mockResolvedValue(mockManifest);
  });

  describe('install', () => {
    it('should install a package successfully', async () => {
      const result = await manager.install({
        workspaceId: 'ws-1',
        packageName: 'test-agent',
      });

      expect(result.packageName).toBe('test-agent');
      expect(result.workspaceId).toBe('ws-1');
      expect(result.version).toBe('1.0.0');
      expect(result.type).toBe('agent');
      expect(result.status).toBe('installed');
      expect(result.id).toBeDefined();
      expect(result.installedAt).toBeDefined();
    });

    it('should use the requested version when provided', async () => {
      const result = await manager.install({
        workspaceId: 'ws-1',
        packageName: 'test-agent',
        version: '0.9.0',
      });

      expect(result.version).toBe('0.9.0');
    });

    it('should store config on the installation', async () => {
      const result = await manager.install({
        workspaceId: 'ws-1',
        packageName: 'test-agent',
        config: { apiKey: 'secret' },
      });

      expect(result.config).toEqual({ apiKey: 'secret' });
    });

    it('should fail when dependencies conflict', async () => {
      vi.spyOn(resolver, 'resolve').mockResolvedValueOnce({
        toInstall: [],
        toUpgrade: [],
        conflicts: [{ name: 'dep-a', required: '^2.0.0', installed: '1.0.0' }],
      });

      await expect(
        manager.install({
          workspaceId: 'ws-1',
          packageName: 'conflicting-pkg',
        }),
      ).rejects.toThrow('Dependency conflicts');
    });

    it('should load manifest from GitHub when source is a GitHub URL', async () => {
      await manager.install({
        workspaceId: 'ws-1',
        packageName: 'gh-agent',
        source: 'https://github.com/org/repo',
      });

      expect(loader.loadFromGitHub).toHaveBeenCalledWith('https://github.com/org/repo', undefined);
    });

    it('should load manifest from path when source is a local path', async () => {
      await manager.install({
        workspaceId: 'ws-1',
        packageName: 'local-agent',
        source: '/opt/packages/my-agent',
      });

      expect(loader.loadFromPath).toHaveBeenCalledWith('/opt/packages/my-agent');
    });
  });

  describe('upgrade', () => {
    it('should upgrade an installed package', async () => {
      const installed = await manager.install({
        workspaceId: 'ws-1',
        packageName: 'test-agent',
      });

      vi.spyOn(loader, 'loadFromPackagehub').mockResolvedValueOnce(mockManifestV2);

      const upgraded = await manager.upgrade(installed.id, '2.0.0');

      expect(upgraded.version).toBe('2.0.0');
      expect(upgraded.status).toBe('installed');
    });

    it('should throw when installation not found', async () => {
      await expect(manager.upgrade('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('remove', () => {
    it('should remove an installed package', async () => {
      const installed = await manager.install({
        workspaceId: 'ws-1',
        packageName: 'test-agent',
      });

      await manager.remove(installed.id);

      await expect(manager.getStatus(installed.id)).rejects.toThrow('not found');
    });

    it('should throw when installation not found', async () => {
      await expect(manager.remove('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('list', () => {
    it('should list packages for a workspace', async () => {
      await manager.install({
        workspaceId: 'ws-1',
        packageName: 'agent-a',
      });

      vi.spyOn(loader, 'loadFromPackagehub').mockResolvedValueOnce({
        ...mockManifest,
        name: 'agent-b',
      });

      await manager.install({
        workspaceId: 'ws-1',
        packageName: 'agent-b',
      });

      await manager.install({
        workspaceId: 'ws-2',
        packageName: 'agent-c',
      });

      const ws1Packages = await manager.list('ws-1');
      expect(ws1Packages).toHaveLength(2);

      const ws2Packages = await manager.list('ws-2');
      expect(ws2Packages).toHaveLength(1);
    });

    it('should return empty array for workspace with no packages', async () => {
      const packages = await manager.list('ws-empty');
      expect(packages).toEqual([]);
    });
  });

  describe('getStatus', () => {
    it('should return installation status', async () => {
      const installed = await manager.install({
        workspaceId: 'ws-1',
        packageName: 'test-agent',
      });

      const status = await manager.getStatus(installed.id);

      expect(status.id).toBe(installed.id);
      expect(status.status).toBe('installed');
    });

    it('should throw when installation not found', async () => {
      await expect(manager.getStatus('nonexistent')).rejects.toThrow('not found');
    });
  });
});
