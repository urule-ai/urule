import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';

describe('packages — x-correlation-id propagation via real buildServer', () => {
  const FAKE_CONFIG = {
    port: 0,
    host: '127.0.0.1',
    natsUrl: 'nats://127.0.0.1:1',
    registryUrl: 'http://127.0.0.1:1',
    packagehubUrl: 'http://127.0.0.1:2',
    workDir: '/tmp/urule-packages-test',
    serviceName: 'packages-test',
  };

  it('echoes the inbound x-correlation-id header on the response', async () => {
    const app = await buildServer(FAKE_CONFIG);
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-correlation-id': 'test-packages-abc-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-correlation-id']).toBe('test-packages-abc-123');
    await app.close();
  });

  it('mints a ULID-shaped id when the inbound header is missing', async () => {
    const app = await buildServer(FAKE_CONFIG);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    await app.close();
  });
});
