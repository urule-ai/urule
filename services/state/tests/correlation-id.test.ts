import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';

describe('state — x-correlation-id propagation via real buildServer', () => {
  it('echoes the inbound x-correlation-id header on the response', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-correlation-id': 'test-state-abc-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-correlation-id']).toBe('test-state-abc-123');
    await app.close();
  });

  it('mints a ULID-shaped id when the inbound header is missing', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    await app.close();
  });
});
