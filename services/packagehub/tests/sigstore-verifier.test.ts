import { describe, it, expect, afterEach } from 'vitest';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import {
  parseSigstoreIdentity,
  setSigstoreVerifier,
  type SigstoreIdentity,
  type SigstoreVerifier,
} from '../src/services/sigstore-verifier.js';
import { verifyAgainstActiveKeys } from '../src/services/signing.js';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function rawEd25519PubKeyB64(): { rawPubB64: string; privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'] } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const raw = spki.subarray(spki.length - 32);
  return { rawPubB64: raw.toString('base64'), privateKey };
}

function ed25519SignB64(privateKey: Parameters<typeof sign>[2], data: Buffer): string {
  return sign(null, data, privateKey).toString('base64');
}

function makeMockVerifier(impl?: SigstoreVerifier['verify']): SigstoreVerifier {
  return {
    verify: impl ?? (async () => false),
  };
}

/* ------------------------------------------------------------------ *
 * parseSigstoreIdentity — pure JSON-shape guard
 * ------------------------------------------------------------------ */

describe('parseSigstoreIdentity', () => {
  it('returns the identity for a well-formed `{ issuer, subject }` JSON document', () => {
    const id: SigstoreIdentity = {
      issuer: 'https://accounts.google.com',
      subject: 'alice@example.com',
    };
    expect(parseSigstoreIdentity(JSON.stringify(id))).toEqual(id);
  });

  it('returns null on missing issuer', () => {
    expect(parseSigstoreIdentity(JSON.stringify({ subject: 'a@b' }))).toBeNull();
  });

  it('returns null on missing subject', () => {
    expect(parseSigstoreIdentity(JSON.stringify({ issuer: 'https://x' }))).toBeNull();
  });

  it('returns null on non-string field values', () => {
    expect(parseSigstoreIdentity(JSON.stringify({ issuer: 1, subject: 'a' }))).toBeNull();
  });

  it('returns null on non-JSON input', () => {
    expect(parseSigstoreIdentity('not json')).toBeNull();
  });

  it('returns null on a JSON array (object guard)', () => {
    expect(parseSigstoreIdentity('[]')).toBeNull();
  });

  it('returns null on null literal', () => {
    expect(parseSigstoreIdentity('null')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * verifyAgainstActiveKeys dispatch — covers the new async path
 * ------------------------------------------------------------------ */

describe('verifyAgainstActiveKeys — sigstore-oidc dispatch', () => {
  afterEach(() => {
    setSigstoreVerifier(undefined); // restore the production verifier
  });

  const digest = createHash('sha256').update('hello').digest();
  const validIdentity: SigstoreIdentity = {
    issuer: 'https://token.actions.githubusercontent.com',
    subject: 'https://github.com/example/repo/.github/workflows/release.yml@refs/heads/main',
  };

  it('returns the matching identity JSON when the mock verifier accepts the bundle', async () => {
    const calls: Array<{ bundle: string; identity: SigstoreIdentity }> = [];
    setSigstoreVerifier(makeMockVerifier(async (bundle, _payload, identity) => {
      calls.push({ bundle, identity });
      return true;
    }));

    const result = await verifyAgainstActiveKeys(
      [{ pubkey: JSON.stringify(validIdentity), pubkeyKind: 'sigstore-oidc' }],
      'cosign-bundle-as-json',
      digest,
    );

    expect(result).toBe(JSON.stringify(validIdentity));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.bundle).toBe('cosign-bundle-as-json');
    expect(calls[0]?.identity).toEqual(validIdentity);
  });

  it('returns null when the mock verifier rejects the bundle', async () => {
    setSigstoreVerifier(makeMockVerifier(async () => false));

    const result = await verifyAgainstActiveKeys(
      [{ pubkey: JSON.stringify(validIdentity), pubkeyKind: 'sigstore-oidc' }],
      'cosign-bundle-as-json',
      digest,
    );

    expect(result).toBeNull();
  });

  it('skips a sigstore-oidc row whose identity JSON is malformed (does not crash)', async () => {
    let calledVerifier = false;
    setSigstoreVerifier(makeMockVerifier(async () => {
      calledVerifier = true;
      return true;
    }));

    const result = await verifyAgainstActiveKeys(
      [{ pubkey: '{ not valid json', pubkeyKind: 'sigstore-oidc' }],
      'cosign-bundle-as-json',
      digest,
    );

    expect(result).toBeNull();
    // The verifier must NOT be reached when the identity is unparseable —
    // a malformed row would otherwise leak unbounded JSON into the
    // upstream library before its own validation kicks in.
    expect(calledVerifier).toBe(false);
  });

  it('mixes Ed25519 + sigstore-oidc keys: ed25519 match short-circuits', async () => {
    const { rawPubB64, privateKey } = rawEd25519PubKeyB64();
    const sig = ed25519SignB64(privateKey, digest);

    let sigstoreCalled = false;
    setSigstoreVerifier(makeMockVerifier(async () => {
      sigstoreCalled = true;
      return false; // would-have-failed if reached
    }));

    const result = await verifyAgainstActiveKeys(
      [
        { pubkey: rawPubB64, pubkeyKind: 'ed25519' },
        { pubkey: JSON.stringify(validIdentity), pubkeyKind: 'sigstore-oidc' },
      ],
      sig,
      digest,
    );

    expect(result).toBe(rawPubB64);
    // Short-circuit on first match — never even ask the sigstore branch.
    expect(sigstoreCalled).toBe(false);
  });

  it('mixes Ed25519 + sigstore-oidc keys: sigstore branch is reached when ed25519 fails', async () => {
    const { rawPubB64 } = rawEd25519PubKeyB64();
    let sigstoreCalled = false;
    setSigstoreVerifier(makeMockVerifier(async () => {
      sigstoreCalled = true;
      return true;
    }));

    const result = await verifyAgainstActiveKeys(
      [
        { pubkey: rawPubB64, pubkeyKind: 'ed25519' }, // signature won't match
        { pubkey: JSON.stringify(validIdentity), pubkeyKind: 'sigstore-oidc' },
      ],
      'wrong-sig-for-ed25519-but-ok-as-bundle-for-mock',
      digest,
    );

    expect(result).toBe(JSON.stringify(validIdentity));
    expect(sigstoreCalled).toBe(true);
  });

  it('skips unknown pubkey kinds without erroring (forward-compat)', async () => {
    setSigstoreVerifier(makeMockVerifier(async () => true));

    const result = await verifyAgainstActiveKeys(
      [{ pubkey: 'whatever', pubkeyKind: 'c2pa' }],
      'sig',
      digest,
    );

    expect(result).toBeNull();
  });

  it('passes the canonical digest through to the sigstore verifier as the payload', async () => {
    let receivedPayload: Buffer | undefined;
    setSigstoreVerifier(makeMockVerifier(async (_bundle, payload) => {
      receivedPayload = payload;
      return true;
    }));

    await verifyAgainstActiveKeys(
      [{ pubkey: JSON.stringify(validIdentity), pubkeyKind: 'sigstore-oidc' }],
      'bundle',
      digest,
    );

    // The payload must be the SAME bytes the publisher hashed when
    // running cosign — we ship the canonical digest itself through, not
    // the manifest bytes. If this assertion ever needs to change, update
    // PACKAGES.md's sign-and-publish recipe to match.
    expect(receivedPayload?.equals(digest)).toBe(true);
  });
});
