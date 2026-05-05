import { ulid } from 'ulid';
import { fetchWithCorrelation } from '@urule/correlation-id';
import type { PackageInstallRequest, InstalledPackage, PackageManifest } from '../types.js';
import type { DependencyResolver } from './dependency-resolver.js';
import type { ManifestLoader } from './manifest-loader.js';

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

export class PackageManager {
  private installations = new Map<string, InstalledPackage>();
  // Per (workspaceId|packageName) → version history stack. Each rollback
  // pops the top entry. Stack of length <2 → 404 from the route handler.
  private versionHistory = new Map<string, string[]>();

  constructor(
    private resolver: DependencyResolver,
    private loader: ManifestLoader,
    private packagehubUrl: string = process.env['PACKAGEHUB_URL'] ?? 'http://packagehub:3000',
  ) {}

  private historyKey(workspaceId: string, packageName: string): string {
    return `${workspaceId}::${packageName}`;
  }

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
    const installation: InstalledPackage = {
      id,
      workspaceId: request.workspaceId,
      packageName: request.packageName,
      version: '',
      type: 'unknown',
      status: 'pending',
      installedAt: new Date().toISOString(),
      config: request.config ?? {},
    };

    this.installations.set(id, installation);

    try {
      installation.status = 'installing';

      const manifest = await this.loadManifest(request);
      const installed = this.listSync(request.workspaceId);

      const resolved = await this.resolver.resolve(manifest, installed);

      if (resolved.conflicts.length > 0) {
        installation.status = 'failed';
        throw new Error(
          `Dependency conflicts: ${resolved.conflicts
            .map((c) => `${c.name} requires ${c.required} but ${c.installed} is installed`)
            .join('; ')}`,
        );
      }

      installation.version = request.version ?? manifest.version;
      installation.type = manifest.type;
      installation.status = 'installed';

      // Initialize history with the freshly-installed version.
      this.versionHistory.set(
        this.historyKey(request.workspaceId, request.packageName),
        [installation.version],
      );

      return { ...installation };
    } catch (err) {
      installation.status = 'failed';
      throw err;
    }
  }

  async upgrade(installationId: string, targetVersion?: string): Promise<InstalledPackage> {
    const installation = this.installations.get(installationId);
    if (!installation) {
      throw new Error(`Installation ${installationId} not found`);
    }

    const previousVersion = installation.version;
    installation.status = 'installing';

    try {
      const manifest = await this.loadManifest({
        workspaceId: installation.workspaceId,
        packageName: installation.packageName,
        version: targetVersion,
      });

      const otherInstalled = this.listSync(installation.workspaceId).filter(
        (pkg) => pkg.id !== installationId,
      );

      const resolved = await this.resolver.resolve(manifest, otherInstalled);

      if (resolved.conflicts.length > 0) {
        installation.status = 'installed';
        installation.version = previousVersion;
        throw new Error(
          `Upgrade conflicts: ${resolved.conflicts
            .map((c) => `${c.name} requires ${c.required} but ${c.installed} is installed`)
            .join('; ')}`,
        );
      }

      installation.version = targetVersion ?? manifest.version;
      installation.type = manifest.type;
      installation.status = 'installed';

      const key = this.historyKey(installation.workspaceId, installation.packageName);
      const history = this.versionHistory.get(key) ?? [previousVersion];
      history.push(installation.version);
      this.versionHistory.set(key, history);

      return { ...installation };
    } catch (err) {
      if (installation.status === 'installing') {
        installation.status = 'installed';
        installation.version = previousVersion;
      }
      throw err;
    }
  }

  /**
   * Roll back to the immediately-previous installed version. Throws an
   * Error with code 'NO_HISTORY' when the stack has no prior entry; the
   * route handler translates that to HTTP 404.
   */
  async rollback(installationId: string): Promise<InstalledPackage> {
    const installation = this.installations.get(installationId);
    if (!installation) {
      throw new Error(`Installation ${installationId} not found`);
    }
    const key = this.historyKey(installation.workspaceId, installation.packageName);
    const history = this.versionHistory.get(key) ?? [installation.version];
    if (history.length < 2) {
      const err = new Error(`No prior version to roll back to for ${installation.packageName}`);
      (err as Error & { code: string }).code = 'NO_HISTORY';
      throw err;
    }
    history.pop();
    const previous = history[history.length - 1]!;
    this.versionHistory.set(key, history);
    installation.version = previous;
    installation.status = 'installed';
    return { ...installation };
  }

  async remove(installationId: string): Promise<void> {
    const installation = this.installations.get(installationId);
    if (!installation) {
      throw new Error(`Installation ${installationId} not found`);
    }

    installation.status = 'removing';
    this.installations.delete(installationId);
  }

  async list(workspaceId: string): Promise<InstalledPackage[]> {
    return this.listSync(workspaceId);
  }

  async getStatus(installationId: string): Promise<InstalledPackage> {
    const installation = this.installations.get(installationId);
    if (!installation) {
      throw new Error(`Installation ${installationId} not found`);
    }
    return { ...installation };
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
    const installed = this.listSync(workspaceId).filter((p) => p.status === 'installed');
    const updates: Array<{ installationId: string; packageName: string; installedVersion: string; latestVersion: string }> = [];
    for (const inst of installed) {
      try {
        const url = `${this.packagehubUrl}/api/v1/packages/${encodeURIComponent(inst.packageName)}/versions`;
        const res = await fetchWithCorrelation(url);
        if (!res.ok) continue;
        const versions = await res.json() as Array<{ version: string; yanked?: boolean; publishedAt?: string }>;
        if (!Array.isArray(versions) || versions.length === 0) continue;
        // packagehub already returns versions ordered newest-first by
        // publishedAt; pick the first non-yanked.
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

  private listSync(workspaceId: string): InstalledPackage[] {
    return Array.from(this.installations.values()).filter(
      (pkg) => pkg.workspaceId === workspaceId,
    );
  }

  /**
   * Test seam: lets tests pre-populate an installation without
   * exercising the install path (entitlement check, manifest load).
   * Not exported via the route layer.
   */
  injectInstallationForTest(installation: InstalledPackage): void {
    this.installations.set(installation.id, installation);
  }

  private async loadManifest(request: PackageInstallRequest): Promise<PackageManifest> {
    if (request.source?.startsWith('https://github.com')) {
      return this.loader.loadFromGitHub(request.source, request.version);
    }

    if (request.source) {
      return this.loader.loadFromPath(request.source);
    }

    return this.loader.loadFromPackagehub(request.packageName, request.version);
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
