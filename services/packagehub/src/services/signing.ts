import { createHash, createPublicKey, verify } from 'node:crypto';

/**
 * Active pubkey record — the subset of the `package_pubkeys` row a
 * verifier needs. Defined here so callers don't have to import drizzle
 * types just to call verifyAgainstActiveKeys.
 */
export interface ActivePubkey {
  pubkey: string;
  pubkeyKind: string;
}

/**
 * Compute a deterministic SHA-256 digest over the canonical form of a
 * version's signed material. Both publisher and verifier use this same
 * function, so any layout change breaks all in-flight signatures — keep
 * stable.
 *
 * The canonical form is:
 *   sha256( JSON.stringify(manifest, sortedKeys) || readme || version )
 *
 * `JSON.stringify` with a sorted-keys reviver (passed as the 2nd arg to
 * stringify here) produces stable output across Node versions and platforms.
 */
export function canonicalDigest(manifest: unknown, readme: string, version: string): Buffer {
  const json = JSON.stringify(manifest, Object.keys(manifest as object).sort());
  return createHash('sha256').update(json).update(readme).update(version).digest();
}

/**
 * SubjectPublicKeyInfo wrapper bytes for raw Ed25519 public keys. Allows
 * Node's `createPublicKey` to ingest a 32-byte raw key without external
 * deps. Format: SEQUENCE { AlgorithmIdentifier(1.3.101.112), BIT STRING }
 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verify a base64-encoded Ed25519 signature against a base64-encoded raw
 * 32-byte public key. Returns true if the signature was produced by the
 * holder of the matching private key over `digest`.
 */
export function verifyEd25519(pubkeyB64: string, signatureB64: string, digest: Buffer): boolean {
  const rawKey = Buffer.from(pubkeyB64, 'base64');
  if (rawKey.length !== 32) return false;
  const sig = Buffer.from(signatureB64, 'base64');
  if (sig.length !== 64) return false;
  try {
    const pubkey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, digest, pubkey, sig);
  } catch {
    return false;
  }
}

/**
 * Verify a signature against any of a package's active pubkeys.
 * Returns the matching pubkey (b64) on success, or null on failure.
 *
 * Multiple active keys exist whenever a publisher has rotated mid-life
 * but kept the prior key around (e.g., a hardware-token primary and a
 * CI-pipeline secondary). Verification short-circuits on first match,
 * so the order of `keys` doesn't change correctness.
 */
export function verifyAgainstActiveKeys(
  keys: readonly ActivePubkey[],
  signatureB64: string,
  digest: Buffer,
): string | null {
  for (const key of keys) {
    if (key.pubkeyKind !== 'ed25519') continue; // only ed25519 today
    if (verifyEd25519(key.pubkey, signatureB64, digest)) return key.pubkey;
  }
  return null;
}

/**
 * Compute the digest a publisher must sign to prove possession of an
 * existing private key when rotating to a new one. The proof-of-
 * possession payload binds the operation (`add`/`revoke`), the package
 * name, and the target pubkey — so a signature captured for one
 * rotation can't be replayed onto a different package or operation.
 */
export function rotationDigest(
  operation: 'add' | 'revoke',
  packageName: string,
  targetPubkeyB64: string,
): Buffer {
  return createHash('sha256')
    .update(operation)
    .update('\n')
    .update(packageName)
    .update('\n')
    .update(targetPubkeyB64)
    .digest();
}
