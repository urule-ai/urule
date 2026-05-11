/*
 * Sigstore-OIDC verifier — counterpart to the Ed25519 path in signing.ts.
 *
 * Where Ed25519 stores a raw 32-byte public key + a 64-byte detached
 * signature, the Sigstore path stores a `<issuer>/<subject>` identity (as
 * JSON) and a serialized cosign bundle (the `cosign sign-blob --bundle`
 * output: cert chain, signature, Rekor inclusion proof).
 *
 * Verification delegates to the upstream `sigstore` package:
 *   - cert chain validates against Fulcio's TUF-pinned root
 *   - Rekor entry validates against the transparency-log public key
 *   - signature verifies against the cert's pubkey over the payload
 *   - identity matches against the cert's SAN + issuer extension
 *
 * The verifier is exposed as an injectable `SigstoreVerifier` interface so
 * the route + signing tests can swap in a mock without forking the
 * production network path.
 */

import type { Buffer } from 'node:buffer';

export type SigstoreIdentity = {
  /**
   * Expected OIDC issuer URL — matched against the certificate's
   * 1.3.6.1.4.1.57264.1.1 extension. e.g. `https://accounts.google.com`,
   * `https://token.actions.githubusercontent.com`.
   */
  issuer: string;
  /**
   * Expected SAN — for human signers this is an email; for CI workflow
   * signers a workflow URI such as
   * `https://github.com/owner/repo/.github/workflows/release.yml@refs/heads/main`.
   */
  subject: string;
};

export interface SigstoreVerifier {
  /**
   * Verifies a serialized cosign bundle against `payload` and an expected
   * identity. Returns `true` on success, `false` for any failure (bundle
   * malformed, cert untrusted, Rekor entry missing, signature mismatch, or
   * identity mismatch). Implementations must NOT throw on verification
   * failure — they should return `false` and surface the underlying
   * reason via the optional logger.
   */
  verify(
    bundleJson: string,
    payload: Buffer,
    identity: SigstoreIdentity,
  ): Promise<boolean>;
}

let cached: SigstoreVerifier | undefined;

/**
 * Test seam — replace the verifier with a stub. Pass `undefined` to revert
 * to the production verifier (rebuilt on next call).
 */
export function setSigstoreVerifier(v: SigstoreVerifier | undefined): void {
  cached = v;
}

export function getSigstoreVerifier(): SigstoreVerifier {
  if (!cached) cached = createDefaultVerifier();
  return cached;
}

/**
 * Production verifier — wraps `sigstore.verify`. Picks up TUF cache /
 * mirror config from environment so deployments can pin a private mirror
 * without code changes:
 *   SIGSTORE_TUF_MIRROR_URL    override the public mirror
 *   SIGSTORE_TUF_CACHE_PATH    on-disk TUF cache (eligible for offline use)
 *   SIGSTORE_TUF_FORCE_CACHE   `true` to skip network refresh entirely
 */
function createDefaultVerifier(): SigstoreVerifier {
  return {
    async verify(bundleJson, payload, identity) {
      let bundle;
      try {
        bundle = JSON.parse(bundleJson) as unknown;
      } catch {
        return false;
      }
      try {
        const { verify } = await import('sigstore');
        await verify(bundle as never, payload, {
          certificateIssuer: identity.issuer,
          certificateIdentityURI: identity.subject,
          tufMirrorURL: process.env['SIGSTORE_TUF_MIRROR_URL'],
          tufCachePath: process.env['SIGSTORE_TUF_CACHE_PATH'],
          tufForceCache: process.env['SIGSTORE_TUF_FORCE_CACHE'] === 'true',
        });
        return true;
      } catch {
        // Any verification failure (cert / Rekor / identity / sig) lands here.
        // We deliberately collapse them to a single `false` — operators
        // diagnose via the upstream library's logs at warn level. The
        // alternative (returning structured reasons) leaks signing-system
        // internals to API consumers.
        return false;
      }
    },
  };
}

/**
 * Parse the JSON-encoded `{ issuer, subject }` identity stored in
 * `package_pubkeys.pubkey` (or `packages.publisher_pubkey`) when
 * `pubkey_kind = 'sigstore-oidc'`. Returns `null` for malformed input —
 * callers treat that as a verification failure.
 */
export function parseSigstoreIdentity(pubkey: string): SigstoreIdentity | null {
  try {
    const parsed = JSON.parse(pubkey) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['issuer'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['subject'] === 'string'
    ) {
      return parsed as SigstoreIdentity;
    }
    return null;
  } catch {
    return null;
  }
}
