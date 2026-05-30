import { ulid } from 'ulid';
import { fetchWithCorrelation } from '@urule/correlation-id';
import type { PackageInstallRequest, InstalledPackage, PackageManifest } from '../types.js';
import type { DependencyResolver } from './dependency-resolver.js';
import type { InstallationRecord, InstallationRepo } from './installation-repo.js';
import { isGitHubUrl, resolveLocalInstallPath, type ManifestLoader } from './manifest-loader.js';

/**
 * Thrown when a paid/subscription package's entitlement check fails. Caller
 * (the route handler) translates this to HTTP 402 Payment Required and
 * surfaces the paymentLink in the response body.
 */
export class EntitlementRequiredError extends Error {
  constructor(public readonly details: { packageName: string; licenseTier: string; priceCents?: number; paymentLink?: string }) {
    super(`Package "${details.packageName}" requires purchase (tier=${details.licenseTier})`);
    this.name = 'EntitlementRequiredError';
  }
}

function recordToInstalled(r: InstallationRecord): InstalledPackage {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    packageName: r.packageName,
    version: r.version,
    type: r.type,
    status: r.status as InstalledPackage['status'],
    installedAt: r.installedAt instanceof Date ? r.installedAt.toISOString() : String(r.installedAt),
    config: r.config,
  };
}

export class PackageManager {
  constructor(
    private resolver: DependencyResolver,
    private loader: ManifestLoader,
    private repo: InstallationRepo,
    private packagehubUrl: string = process.env['PACKAGEHUB_URL'] ?? 'http://packagehub:3000',
  ) {}

  /** Throw EntitlementRequiredError if the package isn't free and the consumer has no entitlement. */
  private async checkEntitlement(workspaceId: string, packageName: string): Promise<void> {
    const url = `${this.packagehubUrl}/api/v1/entitlements?packageName=${encodeURIComponent(packageName)}&workspaceId=${encodeURIComponent(workspaceId)}`;
    let res: Response;
    try {
      res = await fetchWithCorrelation(url);
    } catch {
      // packagehub unreachable — let the manifest-loader produce a clearer
      // error a few lines later. Don't block install on a transient outage.
      return;
    }
    if (!res.ok) {
      if (res.status === 404) return;
      throw new Error(`Entitlement check failed: ${res.status} ${res.statusText}`);
    }
    const body = await res.json() as { allowed: boolean; reason: string; licenseTier?: string; priceCents?: number; paymentLink?: string };
    if (!body.allowed) {
      throw new EntitlementRequiredError({
        packageName,
        licenseTier: body.licenseTier ?? 'paid',
        priceCents: body.priceCents,
        paymentLink: body.paymentLink,
      });
    }
  }

  async install(request: PackageInstallRequest): Promise<InstalledPackage> {
    // Entitlement gate first — cheaper than loading the manifest, and
    // rejecting before we mutate state keeps the error path clean.
    await this.checkEntitlement(request.workspaceId, request.packageName);

    const id = ulid();
    const now = new Date();
    const record: InstallationRecord = {
      id,
      workspaceId: request.workspaceId,
      packageName: request.packageName,
      version: '',
      type: 'unknown',
      status: 'pending',
      config: request.config ?? {},
      installedAt: now,
      updatedAt: now,
    };
    await this.repo.insert(record);

    try {
      await this.repo.update(id, { status: 'installing' });

      const manifest = await this.loadManifest(request);
      const installed = await this.list(request.workspaceId);
      const resolved = await this.resolver.resolve(manifest, installed);

      if (resolved.conflicts.length > 0) {
        await this.repo.update(id, { status: 'failed' });
        throw new Error(
          `Dependency conflicts: ${resolved.conflicts
            .map((c) => `${c.name} requires ${c.required} but ${c.installed} is installed`)
            .join('; ')}`,
        );
      }

      const finalVersion = request.version ?? manifest.version;
      const updated = await this.repo.update(id, {
        version: finalVersion,
        type: manifest.type,
        status: 'installed',
      });

      // Seed history with the freshly-installed version.
      await this.repo.appendVersion(id, finalVersion);

      return recordToInstalled(updated!);
    } catch (err) {
      // Mark failed if we haven't already.
      await this.repo.update(id, { status: 'failed' });
      throw err;
    }
  }

  async upgrade(installationId: string, targetVersion?: string): Promise<InstalledPackage> {
    const existing = await this.repo.getById(installationId);
    if (!existing) {
      throw new Error(`Installation ${installationId} not found`);
    }

    const previousVersion = existing.version;
    await this.repo.update(installationId, { status: 'installing' });

    try {
      const manifest = await this.loadManifest({
        workspaceId: existing.workspaceId,
        packageName: existing.packageName,
        version: targetVersion,
      });

      const otherInstalled = (await this.list(existing.workspaceId)).filter(
        (pkg) => pkg.id !== installationId,
      );
      const resolved = await this.resolver.resolve(manifest, otherInstalled);

      if (resolved.conflicts.length > 0) {
        await this.repo.update(installationId, {
          status: 'installed',
          version: previousVersion,
        });
        throw new Error(
          `Upgrade conflicts: ${resolved.conflicts
            .map((c) => `${c.name} requires ${c.required} but ${c.installed} is installed`)
            .join('; ')}`,
        );
      }

      const finalVersion = targetVersion ?? manifest.version;
      const updated = await this.repo.update(installationId, {
        version: finalVersion,
        type: manifest.type,
        status: 'installed',
      });

      await this.repo.appendVersion(installationId, finalVersion);
      return recordToInstalled(updated!);
    } catch (err) {
      // Revert status if the upgrade attempt failed before we bumped to 'installed'.
      const post = await this.repo.getById(installationId);
      if (post && post.status === 'installing') {
        await this.repo.update(installationId, {
          status: 'installed',
          version: previousVersion,
        });
      }
      throw err;
    }
  }

  /**
   * Roll back to the immediately-previous installed version. Throws an
   * Error with code 'NO_HISTORY' when fewer than two history rows exist;
   * the route handler translates that to HTTP 404.
   */
  async rollback(installationId: string): Promise<InstalledPackage> {
    const existing = await this.repo.getById(installationId);
    if (!existing) {
      throw new Error(`Installation ${installationId} not found`);
    }

    const history = await this.repo.getHistory(installationId);
    if (history.length < 2) {
      const err = new Error(`No prior version to roll back to for ${existing.packageName}`);
      (err as Error & { code: string }).code = 'NO_HISTORY';
      throw err;
    }

    // Top of stack is the current version; pop it and revert to the next.
    const [top, previous] = history;
    await this.repo.deleteHistoryRow(top!.id);
    const updated = await this.repo.update(installationId, {
      version: previous!.version,
      status: 'installed',
    });
    return recordToInstalled(updated!);
  }

  async remove(installationId: string): Promise<void> {
    const existed = await this.repo.delete(installationId);
    if (!existed) {
      throw new Error(`Installation ${installationId} not found`);
    }
  }

  async list(workspaceId: string): Promise<InstalledPackage[]> {
    const rows = await this.repo.listByWorkspace(workspaceId);
    return rows.map(recordToInstalled);
  }

  async getStatus(installationId: string): Promise<InstalledPackage> {
    const row = await this.repo.getById(installationId);
    if (!row) {
      throw new Error(`Installation ${installationId} not found`);
    }
    return recordToInstalled(row);
  }

  /**
   * For each installation in `workspaceId`, ask packagehub for the
   * latest non-yanked version of that package. If newer than what's
   * installed, return an entry. Pure read — no install state mutated.
   *
   * Version comparison uses lexicographic ordering as a floor; semver
   * ordering is tracked alongside true semver-range matching as a
   * single follow-up in ROADMAP §6.3 (the `versionRange` field on
   * dependency-tree.ts has the same forward-compat note).
   */
  async checkUpdates(workspaceId: string): Promise<Array<{
    installationId: string;
    packageName: string;
    installedVersion: string;
    latestVersion: string;
  }>> {
    const installed = (await this.list(workspaceId)).filter((p) => p.status === 'installed');
    const updates: Array<{ installationId: string; packageName: string; installedVersion: string; latestVersion: string }> = [];
    for (const inst of installed) {
      try {
        const url = `${this.packagehubUrl}/api/v1/packages/${encodeURIComponent(inst.packageName)}/versions`;
        const res = await fetchWithCorrelation(url);
        if (!res.ok) continue;
        const versions = await res.json() as Array<{ version: string; yanked?: boolean; publishedAt?: string }>;
        if (!Array.isArray(versions) || versions.length === 0) continue;
        const latest = versions.find((v) => !v.yanked);
        if (!latest) continue;
        if (compareVersions(latest.version, inst.version) > 0) {
          updates.push({
            installationId: inst.id,
            packageName: inst.packageName,
            installedVersion: inst.version,
            latestVersion: latest.version,
          });
        }
      } catch {
        // Transient packagehub outage — skip this package's check
        // rather than failing the whole sweep.
      }
    }
    return updates;
  }

  /**
   * Test seam: lets tests pre-populate an installation without
   * exercising the install path (entitlement check, manifest load).
   * Not exported via the route layer.
   */
  async injectInstallationForTest(installation: InstalledPackage): Promise<void> {
    await this.repo.insert({
      id: installation.id,
      workspaceId: installation.workspaceId,
      packageName: installation.packageName,
      version: installation.version,
      type: installation.type,
      status: installation.status,
      config: installation.config,
      installedAt: new Date(installation.installedAt),
      updatedAt: new Date(installation.installedAt),
    });
  }

  private async loadManifest(request: PackageInstallRequest): Promise<PackageManifest> {
    if (!request.source) {
      return this.loader.loadFromPackagehub(request.packageName, request.version);
    }

    // C-10 dispatcher. The pre-fix code used `startsWith('https://github.com')`,
    // which `https://github.com.attacker.com/repo.git` defeats. `isGitHubUrl`
    // parses the URL and enforces an exact hostname match.
    if (isGitHubUrl(request.source)) {
      return this.loader.loadFromGitHub(request.source, request.version);
    }

    // Local-path installs are default-deny. A deployer must set
    // `URULE_PACKAGES_LOCAL_INSTALL_ROOT` and the source must resolve inside
    // it (no `..` escape). Closes the "read /etc/* via source" class of
    // attacks for any authenticated workspace member.
    const localPath = resolveLocalInstallPath(request.source);
    if (localPath) {
      return this.loader.loadFromPath(localPath);
    }

    throw new Error(
      `Refusing install: \`source\` must be a github.com URL, or a path inside URULE_PACKAGES_LOCAL_INSTALL_ROOT when that env var is set`,
    );
  }
}

/**
 * Compare two version strings. Returns >0 if `a > b`, <0 if `a < b`,
 * 0 if equal. Floor implementation: split on dots, compare numeric
 * parts numerically, fall back to string compare for pre-release
 * suffixes ("1.0.0-rc.1" < "1.0.0"). Good enough for the
 * "is the latest published version newer than the installed one?"
 * question. Doesn't replicate the full semver spec — see ROADMAP
 * §6.3 follow-up for proper semver-range handling.
 */
export function compareVersions(a: string, b: string): number {
  const splitVer = (v: string): { core: number[]; pre: string } => {
    const [core, pre = ''] = v.split('-', 2);
    return {
      core: (core ?? '').split('.').map((p) => {
        const n = Number.parseInt(p, 10);
        return Number.isNaN(n) ? 0 : n;
      }),
      pre,
    };
  };
  const A = splitVer(a);
  const B = splitVer(b);
  const len = Math.max(A.core.length, B.core.length);
  for (let i = 0; i < len; i++) {
    const ai = A.core[i] ?? 0;
    const bi = B.core[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  // Pre-release compare: any pre-release < no pre-release; otherwise
  // lexicographic.
  if (A.pre && !B.pre) return -1;
  if (!A.pre && B.pre) return 1;
  if (A.pre && B.pre) return A.pre < B.pre ? -1 : A.pre > B.pre ? 1 : 0;
  return 0;
}
