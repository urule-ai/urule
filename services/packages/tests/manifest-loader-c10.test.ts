import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isGitHubUrl,
  isSafeGitRef,
  resolveLocalInstallPath,
} from '../src/services/manifest-loader.js';

/* ------------------------------------------------------------------ *
 * Phase M / C-10 — input-validation regressions for the package-install
 * source dispatch. The pre-fix code used `startsWith('https://github.com')`
 * (bypassable by `https://github.com.attacker.com/...`), accepted any
 * local path via `loadFromPath(source)`, and passed user-supplied refs
 * straight to `git clone --branch`. These tests pin each guard.
 * ------------------------------------------------------------------ */

describe('isGitHubUrl — strict github.com host check', () => {
  const PASSES = [
    'https://github.com/urule-ai/urule',
    'https://github.com/urule-ai/urule.git',
    'https://github.com/foo/bar',
    'https://github.com/foo/bar/',
  ];
  const FAILS = [
    // The original prefix bypass.
    'https://github.com.attacker.com/x/y',
    // Mistyped TLD.
    'https://github.co/x/y',
    // Subdomain — explicit hostname.
    'https://api.github.com/x/y',
    // Wrong protocol.
    'ssh://git@github.com/x/y',
    'file:///etc/passwd',
    // Path looks like owner/repo but it isn't.
    'https://github.com/',
    'https://github.com/onlyowner',
    // Embedded credentials should still need to parse to github.com host.
    'https://github.com@attacker.com/x/y',
    // Forbidden chars in owner/repo.
    'https://github.com/.%2E/repo',
    'https://github.com/foo/../bar',
    // Bare garbage.
    'not-a-url',
    '',
  ];

  for (const url of PASSES) {
    it(`accepts ${url}`, () => {
      expect(isGitHubUrl(url)).not.toBeNull();
    });
  }
  for (const url of FAILS) {
    it(`rejects ${url}`, () => {
      expect(isGitHubUrl(url)).toBeNull();
    });
  }
});

describe('isSafeGitRef — block argument-injection via --branch', () => {
  const PASSES = ['main', 'v1.2.3', 'release/2026-Q2', 'feature/foo-bar', 'abcdef1234'];
  const FAILS = [
    // Leading dash → git interprets as a flag.
    '-upload-pack=evil',
    '--upload-pack=evil',
    // Newline / shell metacharacters.
    'main; rm -rf /',
    'main\n--upload-pack=evil',
    'main`whoami`',
    'main$(whoami)',
    'main | cat',
    // Backslash / quotes.
    'main\\..',
    'main"',
    // Empty / too long.
    '',
    'x'.repeat(201),
  ];

  for (const ref of PASSES) {
    it(`accepts ${ref}`, () => {
      expect(isSafeGitRef(ref)).toBe(true);
    });
  }
  for (const ref of FAILS) {
    it(`rejects ${JSON.stringify(ref)}`, () => {
      expect(isSafeGitRef(ref)).toBe(false);
    });
  }
});

describe('resolveLocalInstallPath — default-deny + traversal-safe', () => {
  beforeEach(() => {
    delete process.env['URULE_PACKAGES_LOCAL_INSTALL_ROOT'];
  });
  afterEach(() => {
    delete process.env['URULE_PACKAGES_LOCAL_INSTALL_ROOT'];
  });

  it('returns null when URULE_PACKAGES_LOCAL_INSTALL_ROOT is unset (default-deny)', () => {
    expect(resolveLocalInstallPath('/etc/passwd')).toBeNull();
    expect(resolveLocalInstallPath('/opt/packages/foo')).toBeNull();
  });

  it('returns null for paths outside the configured root', () => {
    process.env['URULE_PACKAGES_LOCAL_INSTALL_ROOT'] = '/opt/packages';
    expect(resolveLocalInstallPath('/etc/passwd')).toBeNull();
    expect(resolveLocalInstallPath('/opt/something-else/foo')).toBeNull();
  });

  it('blocks path-traversal escapes (..)', () => {
    process.env['URULE_PACKAGES_LOCAL_INSTALL_ROOT'] = '/opt/packages';
    expect(resolveLocalInstallPath('/opt/packages/../etc/passwd')).toBeNull();
    expect(resolveLocalInstallPath('../etc/passwd')).toBeNull();
    expect(resolveLocalInstallPath('foo/../../etc/passwd')).toBeNull();
  });

  it('accepts paths inside the configured root', () => {
    process.env['URULE_PACKAGES_LOCAL_INSTALL_ROOT'] = '/opt/packages';
    expect(resolveLocalInstallPath('/opt/packages/foo')).toBe('/opt/packages/foo');
    expect(resolveLocalInstallPath('/opt/packages/foo/bar')).toBe('/opt/packages/foo/bar');
    expect(resolveLocalInstallPath('foo')).toBe('/opt/packages/foo');
  });

  it('accepts the root itself', () => {
    process.env['URULE_PACKAGES_LOCAL_INSTALL_ROOT'] = '/opt/packages';
    expect(resolveLocalInstallPath('/opt/packages')).toBe('/opt/packages');
  });
});
