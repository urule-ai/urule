import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * Stripe webhook signature verifier — pure Node, no Stripe SDK dep.
 *
 * Stripe's `Stripe-Signature` header looks like:
 *   t=1492774577,v1=5257a869e7ec...,v1=4f1b0d8c...
 * where:
 *   - `t` is the unix timestamp Stripe used when signing,
 *   - `v1` is one or more HMAC-SHA256 signatures of `${t}.${rawBody}`
 *     using the endpoint's webhook secret.
 *
 * We verify by computing HMAC-SHA256(`${t}.${rawBody}`, secret) and
 * timing-safe-comparing to each provided v1 signature. Multiple v1
 * entries appear during secret-rotation windows; any match passes.
 *
 * `tolerance` (seconds) caps replay-attack window; default 300s = 5min,
 * matching Stripe's documented recommendation. Set 0 to skip the
 * timestamp check (only useful for replaying captured events in tests).
 */

export interface VerifyOptions {
  /** Replay-window in seconds. Default 300 (5 min). 0 disables. */
  tolerance?: number;
  /** Override "now" in ms. Test seam — production code shouldn't pass this. */
  now?: number;
}

export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeSignatureError';
  }
}

interface Parsed {
  t: number;
  v1: string[];
}

function parseHeader(header: string): Parsed {
  const parts = header.split(',').map((p) => p.trim());
  let t: number | null = null;
  const v1: string[] = [];
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq <= 0) continue;
    const key = p.slice(0, eq);
    const value = p.slice(eq + 1);
    if (key === 't') {
      t = Number.parseInt(value, 10);
    } else if (key === 'v1') {
      v1.push(value);
    }
    // v0 (older signatures) intentionally ignored.
  }
  if (t === null || Number.isNaN(t)) {
    throw new StripeSignatureError('Missing timestamp (`t`) in Stripe-Signature header');
  }
  if (v1.length === 0) {
    throw new StripeSignatureError('No v1 signatures in Stripe-Signature header');
  }
  return { t, v1 };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a Stripe webhook signature. Throws StripeSignatureError on
 * any mismatch (bad header, expired timestamp, no signature match) so
 * callers can map to HTTP 400. Returns void on success.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  options: VerifyOptions = {},
): void {
  const { t, v1 } = parseHeader(signatureHeader);

  const tolerance = options.tolerance ?? 300;
  if (tolerance > 0) {
    const now = options.now ?? Date.now();
    const drift = Math.abs(now / 1000 - t);
    if (drift > tolerance) {
      throw new StripeSignatureError(
        `Webhook timestamp outside tolerance (drift ${Math.round(drift)}s > ${tolerance}s)`,
      );
    }
  }

  const payload = `${t}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');

  for (const sig of v1) {
    if (timingSafeEqualHex(expected, sig)) return;
  }
  throw new StripeSignatureError('No v1 signatures matched');
}

/**
 * Build a Stripe-Signature header for a given payload + secret. Used
 * in tests only — production code receives the header from Stripe.
 */
export function buildStripeSignatureHeaderForTest(
  rawBody: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  const payload = `${timestamp}.${rawBody}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}
