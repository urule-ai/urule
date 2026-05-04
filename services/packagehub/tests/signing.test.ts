import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalDigest, verifyEd25519 } from '../src/services/signing.js';

function generateEd25519() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  // Raw 32-byte public key lives at the tail of the SPKI DER.
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const raw = spki.subarray(spki.length - 32);
  return { rawPubB64: raw.toString('base64'), privateKey };
}

describe('@urule/packagehub — signing', () => {
  it('canonicalDigest is stable across key-order changes', () => {
    const m1 = { name: 'pkg', version: '0.1.0', extras: { a: 1, b: 2 } };
    const m2 = { extras: { b: 2, a: 1 }, version: '0.1.0', name: 'pkg' };
    const a = canonicalDigest(m1, 'readme', '0.1.0');
    const b = canonicalDigest(m2, 'readme', '0.1.0');
    // Note: nested object key ordering only stable at the top level via
    // the sortedKeys arg; deeper objects rely on V8 insertion order. For
    // top-level shuffle the digest should match.
    expect(a.equals(b)).toBe(true);
  });

  it('canonicalDigest changes when manifest mutates', () => {
    const m1 = { name: 'pkg', version: '0.1.0' };
    const m2 = { name: 'pkg', version: '0.1.1' };
    const a = canonicalDigest(m1, 'readme', '0.1.0');
    const b = canonicalDigest(m2, 'readme', '0.1.0');
    expect(a.equals(b)).toBe(false);
  });

  it('canonicalDigest changes when readme mutates', () => {
    const m = { name: 'pkg', version: '0.1.0' };
    const a = canonicalDigest(m, 'readme A', '0.1.0');
    const b = canonicalDigest(m, 'readme B', '0.1.0');
    expect(a.equals(b)).toBe(false);
  });

  it('round-trip: sign + verify succeeds for the holder of the private key', () => {
    const { rawPubB64, privateKey } = generateEd25519();
    const m = { name: 'pkg', version: '0.1.0' };
    const digest = canonicalDigest(m, 'readme', '0.1.0');
    const sig = sign(null, digest, privateKey);
    expect(verifyEd25519(rawPubB64, sig.toString('base64'), digest)).toBe(true);
  });

  it('verify fails when the manifest is tampered with', () => {
    const { rawPubB64, privateKey } = generateEd25519();
    const m = { name: 'pkg', version: '0.1.0' };
    const digest = canonicalDigest(m, 'readme', '0.1.0');
    const sig = sign(null, digest, privateKey);
    const tampered = canonicalDigest({ name: 'pkg', version: '0.1.1' }, 'readme', '0.1.0');
    expect(verifyEd25519(rawPubB64, sig.toString('base64'), tampered)).toBe(false);
  });

  it('verify fails for the wrong public key', () => {
    const a = generateEd25519();
    const b = generateEd25519();
    const m = { name: 'pkg', version: '0.1.0' };
    const digest = canonicalDigest(m, 'readme', '0.1.0');
    const sig = sign(null, digest, a.privateKey);
    expect(verifyEd25519(b.rawPubB64, sig.toString('base64'), digest)).toBe(false);
  });

  it('verify rejects malformed pubkey or signature lengths', () => {
    const digest = canonicalDigest({}, '', '0.1.0');
    expect(verifyEd25519('AA==', 'AA==', digest)).toBe(false);
    expect(verifyEd25519(Buffer.alloc(32).toString('base64'), 'AA==', digest)).toBe(false);
  });
});
