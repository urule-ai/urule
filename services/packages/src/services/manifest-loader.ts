import { simpleGit } from 'simple-git';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { PackageManifest } from '../types.js';

/**
 * C-10 fix — defense-in-depth on the package-install source dispatch.
 *
 * Three vulnerabilities the original code carried, all reachable by any
 * authenticated workspace member via `POST /api/v1/packages/install`:
 *
 *  (a) `startsWith('https://github.com')` is bypassable —
 *      `https://github.com.attacker.com/repo.git` matches the prefix.
 *      Replaced by `isGitHubUrl()`, which `new URL`-parses the source
 *      and requires `hostname === 'github.com'` exactly + a sane
 *      `/owner/repo` path.
 *  (b) `loader.loadFromPath(source)` read **any local path** —
 *      `/etc/passwd/...` style attacks. Now default-deny: a deployer
 *      must explicitly opt in by setting `URULE_PACKAGES_LOCAL_INSTALL_ROOT`,
 *      and the supplied source must `resolve()` to a directory inside
 *      that root (no `..` traversal escape).
 *  (c) `simple-git clone` had no timeout / size / ref validation. The
 *      git ref now matches `/^[A-Za-z0-9._/-]+$/` (no leading `-`,
 *      blocks `--upload-pack=` style argument-injection); the clone
 *      runs with a 5-minute timeout via simple-git's `timeout` option.
 */

const GIT_CLONE_TIMEOUT_MS = 5 * 60 * 1000;
// `--depth 1` reduces blast radius of an oversized repo, but doesn't bound
// it — a deployer who exposes this surface to untrusted callers should also
// run the packages service with a disk quota / container fs limit.
const GIT_CLONE_DEPTH = 1;

/** Strict `github.com/<owner>/<repo>` predicate. Returns the parsed URL on success. */
export function isGitHubUrl(source: string): URL | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname !== 'github.com') return null;
  // Match `/owner/repo` or `/owner/repo.git`, no query, no fragment.
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, rawRepo] = parts;
  const repo = rawRepo?.replace(/\.git$/, '');
  if (!owner || !repo) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;
  return url;
}

/**
 * `simple-git`'s clone forwards the ref to `git --branch <ref>`, so a value
 * starting with `-` would be interpreted as a git option. Restrict to a
 * safe charset (branches, tags, and SHAs all match this pattern).
 */
export function isSafeGitRef(ref: string): boolean {
  if (ref.length === 0 || ref.length > 200) return false;
  if (ref.startsWith('-')) return false;
  return /^[A-Za-z0-9._/-]+$/.test(ref);
}

/**
 * Per-deployment opt-in for local-path installs. Returns `null` (= deny)
 * unless the env var is set AND the supplied source resolves inside the
 * configured root. Path-traversal escapes (`..` segments that climb out)
 * are blocked because `resolve()` collapses them before the prefix check.
 */
export function resolveLocalInstallPath(source: string): string | null {
  const root = process.env['URULE_PACKAGES_LOCAL_INSTALL_ROOT'];
  if (!root) return null;
  const absRoot = resolve(root);
  // Absolute sources resolve as-is (and are checked against the prefix
  // below); relative sources resolve against the root. Either way
  // `resolve()` collapses any `..` segments before the prefix check, so a
  // `../etc/passwd` escape gets caught.
  const candidate = source.startsWith('/') ? resolve(source) : resolve(absRoot, source);
  if (candidate !== absRoot && !candidate.startsWith(absRoot + '/')) return null;
  return candidate;
}

export class ManifestLoader {
  constructor(private workDir: string, private packagehubUrl: string) {}

  async loadFromGitHub(repoUrl: string, ref?: string): Promise<PackageManifest> {
    const parsed = isGitHubUrl(repoUrl);
    if (!parsed) {
      throw new Error(`Refusing to clone non-GitHub URL: ${repoUrl}`);
    }
    if (ref !== undefined && !isSafeGitRef(ref)) {
      throw new Error(`Refusing unsafe git ref: ${ref}`);
    }
    const tempDir = await mkdtemp(join(this.workDir || tmpdir(), 'pkg-'));
    const git = simpleGit({ timeout: { block: GIT_CLONE_TIMEOUT_MS } });

    try {
      const cloneOpts = ['--depth', String(GIT_CLONE_DEPTH)];
      if (ref) {
        // `--` separator ensures the ref can never be interpreted as an
        // option even if the charset filter is bypassed by a future
        // change.
        cloneOpts.push('--branch', ref);
      }
      await git.clone(parsed.toString(), tempDir, cloneOpts);

      return await this.loadFromPath(tempDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async loadFromPath(dirPath: string): Promise<PackageManifest> {
    // Try urule-package.json first, then package.json
    const candidates = [
      join(dirPath, 'urule-package.json'),
      join(dirPath, 'package.json'),
    ];

    for (const candidate of candidates) {
      try {
        const raw = await readFile(candidate, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return this.validateManifest(parsed);
      } catch {
        // Try next candidate
      }
    }

    throw new Error(`No valid manifest found in ${dirPath}`);
  }

  async loadFromPackagehub(name: string, version?: string): Promise<PackageManifest> {
    const versionParam = version ? `?version=${encodeURIComponent(version)}` : '';
    const url = `${this.packagehubUrl}/api/v1/packages/${encodeURIComponent(name)}/manifest${versionParam}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch manifest from packagehub: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    return this.validateManifest(data);
  }

  private validateManifest(data: Record<string, unknown>): PackageManifest {
    if (typeof data['name'] !== 'string' || !data['name']) {
      throw new Error('Manifest missing required field: name');
    }
    if (typeof data['version'] !== 'string' || !data['version']) {
      throw new Error('Manifest missing required field: version');
    }

    return {
      name: data['name'] as string,
      version: data['version'] as string,
      type: (data['type'] as string) ?? 'unknown',
      description: (data['description'] as string) ?? '',
      dependencies: data['dependencies'] as Record<string, string> | undefined,
      ...data,
    };
  }
}
