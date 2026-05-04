import { describe, it, expect, beforeEach, afterEach } from 'vitest';

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

  it('returns null when OTEL_DISABLED=true (no SDK started)', async () => {
    process.env['OTEL_DISABLED'] = 'true';
    const { initOtel } = await import('../src/otel.js');
    const sdk = initOtel('test-svc');
    expect(sdk).toBeNull();
  });

  it('returns a NodeSDK instance when not disabled', async () => {
    const { initOtel } = await import('../src/otel.js');
    const sdk = initOtel('test-svc', { endpoint: 'http://127.0.0.1:1' });
    expect(sdk).not.toBeNull();
    expect(typeof sdk!.shutdown).toBe('function');
    await sdk!.shutdown();
  });
});
