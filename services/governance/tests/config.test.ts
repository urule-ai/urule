import { describe, it, expect } from 'vitest';
import { loadConfig, validateConfig } from '../src/config.js';

describe('governance — config validation (fail-fast)', () => {
  it('throws when NATS_URL is missing', () => {
    const original = process.env.NATS_URL;
    delete process.env.NATS_URL;
    try {
      const cfg = loadConfig();
      expect(() => validateConfig(cfg)).toThrowError(/NATS_URL/);
    } finally {
      if (original !== undefined) process.env.NATS_URL = original;
    }
  });

  it('does not throw when NATS_URL is set (OPENFGA_STORE_ID stays warn-only)', () => {
    const originalNats = process.env.NATS_URL;
    const originalStore = process.env.OPENFGA_STORE_ID;
    process.env.NATS_URL = 'nats://example.host:4222';
    delete process.env.OPENFGA_STORE_ID;
    try {
      const cfg = loadConfig();
      expect(() => validateConfig(cfg)).not.toThrow();
    } finally {
      if (originalNats !== undefined) process.env.NATS_URL = originalNats;
      else delete process.env.NATS_URL;
      if (originalStore !== undefined) process.env.OPENFGA_STORE_ID = originalStore;
    }
  });
});
