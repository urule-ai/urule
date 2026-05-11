import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Static import so the cold-load cost of @opentelemetry/sdk-node + all the
// auto-instrumentations (HTTP, gRPC, PG, Redis, …) is paid in vitest's
// `collect` phase, not inside the 5s per-test timeout. Previously this lived
// inside each `it()` as `await import(...)` and would flake on the first test
// when the module cache was cold. initOtel reads `process.env['OTEL_DISABLED']`
// at call time (not at module-load), so the import doesn't have to be after
// the env-var set. (#62)
import { initOtel } from '../src/otel.js';

describe('@urule/observability — initOtel', () => {
  const originalDisabled = process.env['OTEL_DISABLED'];

  beforeEach(() => {
    delete process.env['OTEL_DISABLED'];
  });

  afterEach(() => {
    if (originalDisabled === undefined) {
      delete process.env['OTEL_DISABLED'];
    } else {
      process.env['OTEL_DISABLED'] = originalDisabled;
    }
  });

  it('returns null when OTEL_DISABLED=true (no SDK started)', () => {
    process.env['OTEL_DISABLED'] = 'true';
    const sdk = initOtel('test-svc');
    expect(sdk).toBeNull();
  });

  it('returns a NodeSDK instance when not disabled', async () => {
    const sdk = initOtel('test-svc', { endpoint: 'http://127.0.0.1:1' });
    expect(sdk).not.toBeNull();
    expect(typeof sdk!.shutdown).toBe('function');
    await sdk!.shutdown();
  });
});
