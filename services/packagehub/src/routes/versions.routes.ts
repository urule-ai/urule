import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { packages } from '../db/schema/packages.js';
import { packageVersions } from '../db/schema/versions.js';
import { canonicalDigest, verifyAgainstActiveKeys, type ActivePubkey } from '../services/signing.js';
import { packagePubkeys } from '../db/schema/package-pubkeys.js';

const publishVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  manifest: z.object({}).passthrough(),
  readme: z.string().optional(),
  checksum: z.string().optional(),
  signature: z.string().optional(),
});

export function registerVersionRoutes(app: FastifyInstance, db: Database) {
  // List versions for a package
  app.get<{ Params: { name: string } }>(
    '/api/v1/packages/:name/versions',
    async (request, reply) => {
      const { name } = request.params;

      const [pkg] = await db.select().from(packages).where(eq(packages.name, name));
      if (!pkg) {
        reply.status(404).send({
          error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
        });
        return;
      }

      return db
        .select()
        .from(packageVersions)
        .where(eq(packageVersions.packageId, pkg.id))
        .orderBy(desc(packageVersions.publishedAt));
    },
  );

  // Publish a new version
  app.post<{
    Params: { name: string };
    Body: {
      version: string;
      manifest: Record<string, unknown>;
      readme?: string;
      checksum?: string;
    };
  }>('/api/v1/packages/:name/versions', async (request, reply) => {
    const parsed = publishVersionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { name } = request.params;
    const { version, manifest, readme, checksum, signature } = parsed.data;

    const [pkg] = await db.select().from(packages).where(eq(packages.name, name));
    if (!pkg) {
      reply.status(404).send({
        error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
      });
      return;
    }

    // Signing: if the parent package has any registered pubkey (the
    // canonical publisher_pubkey OR any active row in package_pubkeys),
    // every subsequent version MUST be signed and verifiable against
    // one of the active keys. Anonymous packages (no pubkey at all)
    // skip this check for back-compat.
    if (pkg.publisherPubkey) {
      if (!signature) {
        return reply.code(400).send({
          error: {
            code: 'SIGNATURE_REQUIRED',
            message: `Package "${name}" requires signed version publishes`,
          },
        });
      }
      // Walk every active rotation row. The migration backfilled a row
      // for every legacy publisher_pubkey, so this works for older
      // packages too. We still keep the publisher_pubkey-only fallback
      // below for the edge case of a pristine install without the
      // backfill having run yet.
      const activeKeys = await db
        .select({ pubkey: packagePubkeys.pubkey, pubkeyKind: packagePubkeys.pubkeyKind })
        .from(packagePubkeys)
        .where(and(eq(packagePubkeys.packageId, pkg.id), eq(packagePubkeys.status, 'active')));
      const keys: ActivePubkey[] =
        activeKeys.length > 0
          ? activeKeys
          : [{ pubkey: pkg.publisherPubkey, pubkeyKind: pkg.pubkeyKind ?? 'ed25519' }];
      const digest = canonicalDigest(manifest, readme ?? '', version);
      const matched = verifyAgainstActiveKeys(keys, signature, digest);
      if (!matched) {
        return reply.code(401).send({
          error: {
            code: 'SIGNATURE_INVALID',
            message: 'Signature does not verify against any active publisher key',
          },
        });
      }
    }

    const id = ulid();
    const now = new Date();

    const [ver] = await db.insert(packageVersions).values({
      id,
      packageId: pkg.id,
      version,
      manifest,
      readme: readme ?? '',
      checksum: checksum ?? null,
      publishedAt: now,
      yanked: false,
      signature: signature ?? null,
      signatureKind: 'ed25519',
      signedAt: signature ? now : null,
    }).returning();

    // Update the package's updatedAt timestamp
    await db
      .update(packages)
      .set({ updatedAt: now })
      .where(eq(packages.id, pkg.id));

    reply.status(201).send(ver);
  });

  // Get a specific version
  app.get<{ Params: { name: string; version: string } }>(
    '/api/v1/packages/:name/versions/:version',
    async (request, reply) => {
      const { name, version } = request.params;

      const [pkg] = await db.select().from(packages).where(eq(packages.name, name));
      if (!pkg) {
        reply.status(404).send({
          error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
        });
        return;
      }

      const [ver] = await db
        .select()
        .from(packageVersions)
        .where(
          and(
            eq(packageVersions.packageId, pkg.id),
            eq(packageVersions.version, version),
          ),
        );

      if (!ver) {
        reply.status(404).send({
          error: {
            code: 'VERSION_NOT_FOUND',
            message: `Version "${version}" not found for package "${name}"`,
          },
        });
        return;
      }

      return ver;
    },
  );

  // Verify a published version's signature on-demand. Useful for clients
  // about to install: they fetch the version, verify, then install.
  app.get<{ Params: { name: string; version: string } }>(
    '/api/v1/packages/:name/versions/:version/verify',
    async (request, reply) => {
      const { name, version } = request.params;

      const [pkg] = await db.select().from(packages).where(eq(packages.name, name));
      if (!pkg) {
        return reply.code(404).send({
          error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
        });
      }

      const [ver] = await db
        .select()
        .from(packageVersions)
        .where(
          and(
            eq(packageVersions.packageId, pkg.id),
            eq(packageVersions.version, version),
          ),
        );
      if (!ver) {
        return reply.code(404).send({
          error: { code: 'VERSION_NOT_FOUND', message: `Version "${version}" not found` },
        });
      }

      if (!pkg.publisherPubkey || !ver.signature) {
        return { verified: false, kind: null, publisher: null, reason: 'unsigned' };
      }

      const digest = canonicalDigest(ver.manifest, ver.readme ?? '', ver.version);
      // Walk active rotation keys; surface the specific key that matched
      // so the consumer can see which generation of the publisher's
      // identity signed this version.
      const activeKeys = await db
        .select({ pubkey: packagePubkeys.pubkey, pubkeyKind: packagePubkeys.pubkeyKind })
        .from(packagePubkeys)
        .where(and(eq(packagePubkeys.packageId, pkg.id), eq(packagePubkeys.status, 'active')));
      const keys: ActivePubkey[] =
        activeKeys.length > 0
          ? activeKeys
          : [{ pubkey: pkg.publisherPubkey, pubkeyKind: pkg.pubkeyKind ?? 'ed25519' }];
      const matched = verifyAgainstActiveKeys(keys, ver.signature, digest);
      const ok = matched !== null;
      return {
        verified: ok,
        kind: pkg.pubkeyKind ?? 'ed25519',
        publisher: matched ?? pkg.publisherPubkey,
        ...(ok ? {} : { reason: 'signature_invalid' }),
      };
    },
  );
}
