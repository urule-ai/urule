import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { packages } from '../db/schema/packages.js';
import { packageVersions } from '../db/schema/versions.js';

export interface DependencyTreeNode {
  /** Package name as declared in the parent's manifest. */
  name: string;
  /** Resolved version: the latest non-yanked version on the requested major (or null if missing). */
  resolvedVersion: string | null;
  /** Free-form version range from the parent manifest (e.g. "^1.0.0", "~0.2.1"). */
  versionRange: string;
  /** Children, recursively. Empty when leaf. */
  dependencies: DependencyTreeNode[];
  /**
   * Set when the resolver gives up:
   *   "missing"       — package not published in packagehub
   *   "no_version"    — package exists but no version matches the range
   *   "cycle"         — already visited on the current path; not re-walked
   *   "max_depth"     — depth limit reached (cuts off pathological graphs)
   */
  unresolved?: 'missing' | 'no_version' | 'cycle' | 'max_depth';
}

interface DependencyManifestShape {
  dependencies?: Array<{ packageName?: string; versionRange?: string }>;
}

interface BuildOptions {
  /** Hard cap on recursion depth. Default 8 — most real-world graphs are <5. */
  maxDepth?: number;
}

/**
 * Resolve a package version's dependency manifest into a tree by
 * recursively walking each dep's latest matching version's manifest.
 *
 * Resolution strategy is "latest non-yanked" — semver range matching is
 * NOT implemented at this floor; the `versionRange` field is preserved
 * verbatim so consumers can see what was requested vs what was resolved.
 * If/when proper range resolution lands (semver.satisfies on a sorted
 * version list), only this file changes.
 *
 * Cycle detection uses a per-path `Set<string>` so two siblings sharing
 * a transitive dep both resolve fully — a node is only marked `cycle`
 * when it appears on its own ancestor chain.
 */
export async function buildDependencyTree(
  db: Database,
  rootPackageName: string,
  rootVersion: string,
  options: BuildOptions = {},
): Promise<DependencyTreeNode | null> {
  const maxDepth = options.maxDepth ?? 8;

  const [rootPkg] = await db.select().from(packages).where(eq(packages.name, rootPackageName));
  if (!rootPkg) return null;

  const [rootVer] = await db
    .select()
    .from(packageVersions)
    .where(and(eq(packageVersions.packageId, rootPkg.id), eq(packageVersions.version, rootVersion)));
  if (!rootVer) return null;

  const visit = async (
    name: string,
    version: string | null,
    versionRange: string,
    manifest: DependencyManifestShape,
    path: Set<string>,
    depth: number,
  ): Promise<DependencyTreeNode> => {
    const node: DependencyTreeNode = {
      name,
      resolvedVersion: version,
      versionRange,
      dependencies: [],
    };

    if (depth >= maxDepth) {
      node.unresolved = 'max_depth';
      return node;
    }

    const deps = manifest.dependencies ?? [];
    for (const dep of deps) {
      const childName = dep.packageName ?? '';
      const childRange = dep.versionRange ?? '*';
      if (!childName) continue;

      if (path.has(childName)) {
        node.dependencies.push({
          name: childName,
          resolvedVersion: null,
          versionRange: childRange,
          dependencies: [],
          unresolved: 'cycle',
        });
        continue;
      }

      const [childPkg] = await db.select().from(packages).where(eq(packages.name, childName));
      if (!childPkg) {
        node.dependencies.push({
          name: childName,
          resolvedVersion: null,
          versionRange: childRange,
          dependencies: [],
          unresolved: 'missing',
        });
        continue;
      }

      // Resolution rule (floor): pick the latest non-yanked version. A
      // future commit can swap this for semver-range matching once we
      // settle on a versioning convention; the `versionRange` field is
      // kept verbatim so the contract is forward-compatible.
      const [childVer] = await db
        .select()
        .from(packageVersions)
        .where(and(eq(packageVersions.packageId, childPkg.id), eq(packageVersions.yanked, false)))
        .orderBy(desc(packageVersions.publishedAt))
        .limit(1);
      if (!childVer) {
        node.dependencies.push({
          name: childName,
          resolvedVersion: null,
          versionRange: childRange,
          dependencies: [],
          unresolved: 'no_version',
        });
        continue;
      }

      const childManifest = (childVer.manifest ?? {}) as DependencyManifestShape;
      const nextPath = new Set(path);
      nextPath.add(name);
      const childNode = await visit(
        childName,
        childVer.version,
        childRange,
        childManifest,
        nextPath,
        depth + 1,
      );
      node.dependencies.push(childNode);
    }

    return node;
  };

  return visit(
    rootPackageName,
    rootVersion,
    rootVersion,
    (rootVer.manifest ?? {}) as DependencyManifestShape,
    new Set(),
    0,
  );
}
