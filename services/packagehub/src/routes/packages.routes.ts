import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { eq, desc } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { packages } from '../db/schema/packages.js';
import { packageVersions } from '../db/schema/versions.js';
import { packagePubkeys } from '../db/schema/package-pubkeys.js';
import { SearchService } from '../services/search.js';

const publishPackageSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  description: z.string().optional(),
  author: z.string().min(1),
  repository: z.string().url().optional(),
  homepage: z.string().url().optional(),
  license: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // Signing: opt-in. When set, every version publish must verify against
  // this key. Once set on first publish, cannot be changed (immutable
  // identity binding).
  publisherPubkey: z.string().optional(),
  pubkeyKind: z.enum(['ed25519']).optional(),
  // Marketplace: opt-in. Default 'free' keeps the open-source path; 'paid'
  // and 'subscription' gate install via the entitlement check.
  licenseTier: z.enum(['free', 'paid', 'subscription']).optional(),
  priceCents: z.number().int().nonnegative().optional(),
  paymentProvider: z.enum(['stripe', 'lemonsqueezy']).optional(),
  paymentLink: z.string().url().optional(),
});

const searchQuerySchema = z.object({
  q: z.string().optional(),
  type: z.string().optional(),
  verified: z.string().optional(),
  sort: z.string().optional(),
  limit: z.coerce.number().max(100).optional(),
  offset: z.coerce.number().optional(),
});

/** Attach the latest non-yanked version to each package row. */
async function attachLatestVersions(db: Database, pkgs: Record<string, unknown>[]) {
  if (pkgs.length === 0) return pkgs;
  const pkgIds = pkgs.map(p => p.id as string);
  const versions = await db
    .select()
    .from(packageVersions)
    .where(eq(packageVersions.yanked, false))
    .orderBy(desc(packageVersions.publishedAt));

  const latestByPkg = new Map<string, Record<string, unknown>>();
  for (const v of versions) {
    if (pkgIds.includes(v.packageId) && !latestByPkg.has(v.packageId)) {
      latestByPkg.set(v.packageId, v as Record<string, unknown>);
    }
  }
  return pkgs.map(p => ({
    ...p,
    latest_version: latestByPkg.get(p.id as string) ?? null,
  }));
}

export function registerPackageRoutes(app: FastifyInstance, db: Database) {
  const searchService = new SearchService(db);

  // List / search packages (with latest version manifest attached)
  app.get<{
    Querystring: z.infer<typeof searchQuerySchema>;
  }>('/api/v1/packages', {
    schema: {
      tags: ['packages'],
      summary: 'Search / list packages',
      description:
        'Returns packages matching the query parameters with the latest non-yanked version manifest attached. Supports `?q=` text search, `?type=` exact match, `?verified=true` filter, and `?sort=popular|recent`. Public route — no auth required.',
      querystring: searchQuerySchema,
    },
  }, async (request) => {
    const { q, type, verified, sort, limit } = request.query;

    let results;
    if (sort === 'popular') {
      results = await searchService.getPopular(limit);
    } else if (sort === 'recent') {
      results = await searchService.getRecent(limit);
    } else {
      results = await searchService.search(q ?? '', {
        type,
        verified: verified !== undefined ? verified === 'true' : undefined,
      });
    }
    return attachLatestVersions(db, results as unknown as Record<string, unknown>[]);
  });

  // Register / publish a package
  app.post<{
    Body: z.infer<typeof publishPackageSchema>;
  }>('/api/v1/packages', {
    schema: {
      tags: ['packages'],
      summary: 'Register a new package',
      description:
        'Creates a package record owned by the authenticated user (its `publisherId`) — only that account may publish new versions. Optional `publisherPubkey` (base64 Ed25519) opts the package into mandatory signed-version publishes. License tier defaults to `free`; `paid` / `subscription` tiers must include `priceCents` + a `paymentLink` for the marketplace flow.',
      body: publishPackageSchema,
    },
  }, async (request, reply) => {
    const user = (request as { uruleUser?: { id?: string } }).uruleUser;
    if (!user?.id) {
      reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      return;
    }
    const {
      name, type, description, author, repository, homepage, license, tags,
      publisherPubkey, pubkeyKind, licenseTier, priceCents, paymentProvider, paymentLink,
    } = request.body;
    const id = ulid();
    const now = new Date();

    const [pkg] = await db.insert(packages).values({
      id,
      name,
      type,
      description: description ?? '',
      author,
      publisherId: user.id,
      repository: repository ?? null,
      homepage: homepage ?? null,
      license: license ?? null,
      verified: false,
      downloads: 0,
      tags: tags ?? [],
      publisherPubkey: publisherPubkey ?? null,
      pubkeyKind: pubkeyKind ?? 'ed25519',
      licenseTier: licenseTier ?? 'free',
      priceCents: priceCents ?? null,
      paymentProvider: paymentProvider ?? null,
      paymentLink: paymentLink ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning();

    // Mirror the initial publisher_pubkey into the rotation table so
    // the verifier (which walks package_pubkeys) treats the original
    // key as active. Subsequent rotations append more rows; revoking
    // the first key works once a successor is registered.
    if (pkg && publisherPubkey) {
      await db.insert(packagePubkeys).values({
        id: ulid(),
        packageId: pkg.id,
        pubkey: publisherPubkey,
        pubkeyKind: pubkeyKind ?? 'ed25519',
        status: 'active',
        addedAt: now,
      });
    }

    reply.status(201).send(pkg);
  });

  // Get package by name
  app.get<{ Params: { name: string } }>('/api/v1/packages/:name', {
    schema: {
      tags: ['packages'],
      summary: 'Get package by name',
      description:
        'Returns the package row including signing metadata (`publisherPubkey`, `pubkeyKind`) and marketplace fields (`licenseTier`, `priceCents`, `paymentLink`). 404 when the name is unknown.',
      params: z.object({ name: z.string() }),
    },
  }, async (request, reply) => {
    const { name } = request.params;
    const [pkg] = await db.select().from(packages).where(eq(packages.name, name));

    if (!pkg) {
      reply.status(404).send({
        error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
      });
      return;
    }

    return pkg;
  });
}
