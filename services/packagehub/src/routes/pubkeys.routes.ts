import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { packages } from '../db/schema/packages.js';
import { packagePubkeys } from '../db/schema/package-pubkeys.js';
import { rotationDigest, verifyAgainstActiveKeys, type ActivePubkey } from '../services/signing.js';

/*
 * Publisher pubkey rotation routes.
 *
 *   GET    /api/v1/packages/:name/pubkeys
 *   POST   /api/v1/packages/:name/pubkeys      (add — proof-of-possession)
 *   PATCH  /api/v1/packages/:name/pubkeys/:id  (revoke — proof-of-possession)
 *
 * Add and revoke each require a `proof` signature over a per-operation
 * digest, signed by ANY currently-active key on the package. This is
 * the only path to rotate or retire keys: there's no admin override
 * exposed via the API. A publisher who loses every private key for a
 * package is locked out and must contact Urule operators for a manual
 * UPDATE — that's deliberate, not a missing feature.
 *
 * Verifying that the *new* key in an `add` is actually controlled by
 * its holder isn't done here — we trust the publisher with the active
 * key to register a new one of their choosing. The reverse (revoking
 * a key) carries the same trust shape.
 */

const addPubkeySchema = z.object({
  /** Base64-encoded raw 32-byte Ed25519 public key. */
  pubkey: z.string().min(43).max(64),
  pubkeyKind: z.enum(['ed25519']).optional(),
  /**
   * Base64-encoded Ed25519 signature over rotationDigest('add', name, pubkey),
   * computed with any currently-active private key on the package.
   */
  proof: z.string().min(64).max(128),
});

const revokePubkeySchema = z.object({
  /** Base64 Ed25519 signature over rotationDigest('revoke', name, pubkey). */
  proof: z.string().min(64).max(128),
});

export function registerPubkeysRoutes(app: FastifyInstance, db: Database): void {
  // List all rotation rows (active + revoked) for transparency.
  app.get<{ Params: { name: string } }>(
    '/api/v1/packages/:name/pubkeys',
    {
      schema: {
        tags: ['pubkeys'],
        summary: 'List publisher pubkeys + rotation history',
        description:
          'Returns every pubkey ever registered for the package — both `active` and `revoked`. Useful for transparency / audit; consumers verifying a signature should use `/verify` instead since it walks active keys server-side.',
      },
    },
    async (request, reply) => {
      const { name } = request.params;
      const [pkg] = await db.select().from(packages).where(eq(packages.name, name));
      if (!pkg) {
        return reply.code(404).send({
          error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
        });
      }
      const rows = await db
        .select()
        .from(packagePubkeys)
        .where(eq(packagePubkeys.packageId, pkg.id));
      return rows;
    },
  );

  // Register a new key (rotation). Must be signed by an existing active key.
  app.post<{ Params: { name: string }; Body: z.infer<typeof addPubkeySchema> }>(
    '/api/v1/packages/:name/pubkeys',
    {
      schema: {
        tags: ['pubkeys'],
        summary: 'Add a new pubkey (rotation)',
        description:
          'Registers a new active pubkey on the package. Body must include the new `pubkey` (base64 Ed25519) and a `proof` — base64 Ed25519 signature over `rotationDigest("add", packageName, newPubkey)`, computed with any currently-active private key. Idempotent: re-registering the same pubkey returns the existing row. 401 PROOF_INVALID on signature mismatch; 400 PACKAGE_UNSIGNED if the package has no active keys (anonymous packages must re-publish to register a key).',
      },
    },
    async (request, reply) => {
      const { name } = request.params;
      const parsed = addPubkeySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      const { pubkey, pubkeyKind = 'ed25519', proof } = parsed.data;

      const [pkg] = await db.select().from(packages).where(eq(packages.name, name));
      if (!pkg) {
        return reply.code(404).send({
          error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
        });
      }

      const activeRows = await db
        .select({ pubkey: packagePubkeys.pubkey, pubkeyKind: packagePubkeys.pubkeyKind })
        .from(packagePubkeys)
        .where(and(eq(packagePubkeys.packageId, pkg.id), eq(packagePubkeys.status, 'active')));
      // Fall back to the legacy publisher_pubkey only if the rotation
      // table is empty (e.g., a freshly-created package whose first
      // version hasn't yet inserted a pubkey row). Anonymous packages
      // have no key at all and therefore can't grow one without first
      // re-publishing; surface that explicitly.
      const activeKeys: ActivePubkey[] =
        activeRows.length > 0
          ? activeRows
          : pkg.publisherPubkey
            ? [{ pubkey: pkg.publisherPubkey, pubkeyKind: pkg.pubkeyKind ?? 'ed25519' }]
            : [];
      if (activeKeys.length === 0) {
        return reply.code(400).send({
          error: {
            code: 'PACKAGE_UNSIGNED',
            message: `Package "${name}" has no active keys; rotation requires an existing key`,
          },
        });
      }

      const digest = rotationDigest('add', name, pubkey);
      const matched = verifyAgainstActiveKeys(activeKeys, proof, digest);
      if (!matched) {
        return reply.code(401).send({
          error: {
            code: 'PROOF_INVALID',
            message: 'Proof of possession does not verify against any active key',
          },
        });
      }

      // Idempotency: if this exact pubkey is already active for this
      // package, return it instead of inserting a duplicate.
      const [dup] = await db
        .select()
        .from(packagePubkeys)
        .where(and(eq(packagePubkeys.packageId, pkg.id), eq(packagePubkeys.pubkey, pubkey)));
      if (dup) {
        return reply.code(200).send(dup);
      }

      const [row] = await db
        .insert(packagePubkeys)
        .values({
          id: ulid(),
          packageId: pkg.id,
          pubkey,
          pubkeyKind,
          status: 'active',
          addedAt: new Date(),
        })
        .returning();
      return reply.code(201).send(row);
    },
  );

  // Revoke a key. Requires a proof signed by an existing active key.
  app.patch<{
    Params: { name: string; id: string };
    Body: z.infer<typeof revokePubkeySchema>;
  }>('/api/v1/packages/:name/pubkeys/:id', {
    schema: {
      tags: ['pubkeys'],
      summary: 'Revoke a pubkey',
      description:
        'Marks a pubkey as `revoked`. Body must include a `proof` — base64 Ed25519 signature over `rotationDigest("revoke", packageName, targetPubkey)` from any currently-active key (including the target, so a key can revoke itself when a successor exists). 409 LAST_ACTIVE_KEY when the target is the only active row — register a successor first. 409 ALREADY_REVOKED when the target is already revoked.',
    },
  }, async (request, reply) => {
    const { name, id } = request.params;
    const parsed = revokePubkeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { proof } = parsed.data;

    const [pkg] = await db.select().from(packages).where(eq(packages.name, name));
    if (!pkg) {
      return reply.code(404).send({
        error: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" not found` },
      });
    }

    const [target] = await db
      .select()
      .from(packagePubkeys)
      .where(and(eq(packagePubkeys.id, id), eq(packagePubkeys.packageId, pkg.id)));
    if (!target) {
      return reply.code(404).send({
        error: { code: 'PUBKEY_NOT_FOUND', message: `Pubkey ${id} not found for package "${name}"` },
      });
    }
    if (target.status !== 'active') {
      return reply.code(409).send({
        error: { code: 'ALREADY_REVOKED', message: 'Pubkey is not active' },
      });
    }

    const activeRows = await db
      .select({ pubkey: packagePubkeys.pubkey, pubkeyKind: packagePubkeys.pubkeyKind })
      .from(packagePubkeys)
      .where(and(eq(packagePubkeys.packageId, pkg.id), eq(packagePubkeys.status, 'active')));
    const digest = rotationDigest('revoke', name, target.pubkey);
    const matched = verifyAgainstActiveKeys(activeRows, proof, digest);
    if (!matched) {
      return reply.code(401).send({
        error: {
          code: 'PROOF_INVALID',
          message: 'Proof of possession does not verify against any active key',
        },
      });
    }

    // Block revoking the last active key — it would lock the publisher
    // out of every future version publish and require operator
    // intervention to recover. Add the new key first, then revoke.
    if (activeRows.length === 1 && activeRows[0]?.pubkey === target.pubkey) {
      return reply.code(409).send({
        error: {
          code: 'LAST_ACTIVE_KEY',
          message: 'Cannot revoke the last active key — add a replacement first',
        },
      });
    }

    const [updated] = await db
      .update(packagePubkeys)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(packagePubkeys.id, id))
      .returning();
    return updated;
  });
}
