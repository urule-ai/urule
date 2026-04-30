import { describe, it, expect } from 'vitest';
import { loadConfig, validateConfig } from '../src/config.js';

describe('state — config validation (fail-fast)', () => {
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

  it('does not throw when NATS_URL is set', () => {
    const original = process.env.NATS_URL;
    process.env.NATS_URL = 'nats://example.host:4222';
    try {
      const cfg = loadConfig();
      expect(() => validateConfig(cfg)).not.toThrow();
    } finally {
      if (original !== undefined) process.env.NATS_URL = original;
      else delete process.env.NATS_URL;
    }
  });
});
