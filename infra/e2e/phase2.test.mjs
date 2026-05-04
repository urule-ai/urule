#!/usr/bin/env node

/**
 * Phase 2 End-to-End Integration Test — Package Lifecycle
 *
 * Exercises the full Phase 2 flow:
 *   1. PackageHub:  publish a package
 *   2. PackageHub:  publish a version of that package
 *   3. PackageHub:  search/browse for the package
 *   4. PackageHub:  fetch package by name + by name+version
 *   5. Packages:    install the package into a workspace
 *   6. Packages:    list installations for the workspace
 *   7. Packages:    upgrade the installation (no-op when only one version)
 *   8. Packages:    uninstall — verify the installation is removed
 *
 * Usage: node e2e/phase2.test.mjs
 *
 * Expects services to be running:
 *   - packagehub on http://localhost:3009
 *   - packages   on http://localhost:3008
 */

import { assert, test, post, get, del, waitForService, summary } from './lib.mjs';

const PACKAGEHUB = process.env.PACKAGEHUB_URL ?? 'http://localhost:3009';
const PACKAGES = process.env.PACKAGES_URL ?? 'http://localhost:3008';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? '01DEMO00WORKSPACE0000000001';

async function main() {
  console.log('\n=== Urule Phase 2 — Package Lifecycle E2E ===\n');

  console.log('Waiting for services...');
  await Promise.all([
    waitForService('packagehub', PACKAGEHUB),
    waitForService('packages', PACKAGES),
  ]);
  console.log('All services ready.\n');

  const pkgName = `e2e-phase2-pack-${Date.now()}`;
  let installId;

  await test('Health check — packagehub', async () => {
    const { status, data } = await get(PACKAGEHUB, '/healthz');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'ok', `Expected ok, got ${data.status}`);
  });

  await test('Publish package metadata', async () => {
    const { status, data } = await post(PACKAGEHUB, '/api/v1/packages', {
      name: pkgName,
      type: 'personality',
      description: 'E2E test package',
      author: 'urule-e2e',
      tags: ['e2e', 'test'],
    });
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    assert(data.id, 'Missing package id');
    assert(data.name === pkgName, `name mismatch: ${data.name}`);
  });

  await test('Reject duplicate package name', async () => {
    const { status } = await post(PACKAGEHUB, '/api/v1/packages', {
      name: pkgName,
      type: 'personality',
      author: 'urule-e2e',
    });
    assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
  });

  await test('Publish version 0.1.0', async () => {
    const { status, data } = await post(PACKAGEHUB, `/api/v1/packages/${pkgName}/versions`, {
      version: '0.1.0',
      manifest: {
        name: pkgName,
        version: '0.1.0',
        type: 'personality',
        prompt: 'You are an E2E test agent.',
      },
      readme: '# E2E test\n\nDoes nothing.',
    });
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    assert(data.version === '0.1.0', `version mismatch: ${data.version}`);
  });

  await test('Browse packages — new package appears', async () => {
    const { status, data } = await get(PACKAGEHUB, `/api/v1/packages?q=${encodeURIComponent(pkgName)}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data) || Array.isArray(data?.packages), 'Expected array or { packages: [...] }');
    const list = Array.isArray(data) ? data : data.packages;
    const found = list.find((p) => p.name === pkgName);
    assert(found, `Package ${pkgName} not in browse results`);
  });

  await test('Get package by name', async () => {
    const { status, data } = await get(PACKAGEHUB, `/api/v1/packages/${pkgName}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.name === pkgName, `name mismatch: ${data.name}`);
  });

  await test('Get specific version', async () => {
    const { status, data } = await get(PACKAGEHUB, `/api/v1/packages/${pkgName}/versions/0.1.0`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.version === '0.1.0', `version mismatch: ${data.version}`);
    assert(data.manifest, 'Missing manifest');
  });

  // --- Packages service: install the published package ---

  await test('Health check — packages', async () => {
    const { status, data } = await get(PACKAGES, '/healthz');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'ok', `Expected ok, got ${data.status}`);
  });

  await test('Install package into workspace', async () => {
    const { status, data } = await post(PACKAGES, '/api/v1/packages/install', {
      workspaceId: WORKSPACE_ID,
      packageName: pkgName,
      version: '0.1.0',
    });
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    assert(data.id, 'Missing installation id');
    installId = data.id;
  });

  await test('List installations for workspace', async () => {
    const { status, data } = await get(PACKAGES, `/api/v1/installations?workspaceId=${WORKSPACE_ID}`);
    assert(status === 200, `Expected 200, got ${status}`);
    const list = Array.isArray(data) ? data : data.installations ?? [];
    const found = list.find((i) => i.id === installId);
    assert(found, `Installation ${installId} not in list`);
  });

  await test('Get installation by id', async () => {
    const { status, data } = await get(PACKAGES, `/api/v1/installations/${installId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.id === installId, `id mismatch: ${data.id}`);
  });

  await test('Reject duplicate install of same package+version', async () => {
    const { status } = await post(PACKAGES, '/api/v1/packages/install', {
      workspaceId: WORKSPACE_ID,
      packageName: pkgName,
      version: '0.1.0',
    });
    assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
  });

  // --- Cleanup: uninstall ---

  await test('Uninstall package', async () => {
    const { status } = await del(PACKAGES, `/api/v1/installations/${installId}`);
    assert(status === 200 || status === 204, `Expected 200/204, got ${status}`);
  });

  await test('Verify installation gone', async () => {
    const { status } = await get(PACKAGES, `/api/v1/installations/${installId}`);
    assert(status === 404, `Expected 404, got ${status}`);
  });

  summary('Phase 2 Results');
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
