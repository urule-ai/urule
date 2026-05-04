import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
  correlationIdPlugin,
  CORRELATION_HEADER,
  getCorrelationId,
  runWithCorrelationId,
} from '../src/index.js';

describe('@urule/correlation-id', () => {
  describe('inbound passthrough', () => {
    it('uses the inbound x-correlation-id header when present', async () => {
      const app = Fastify({ logger: false });
      await app.register(correlationIdPlugin);

      let captured: string | undefined;
      app.get('/x', async (req) => {
        captured = req.correlationId;
        return { ok: true };
      });

      const res = await app.inject({
        method: 'GET',
        url: '/x',
        headers: { [CORRELATION_HEADER]: 'test-abc-123' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers[CORRELATION_HEADER]).toBe('test-abc-123');
      expect(captured).toBe('test-abc-123');
    });

    it('reflects the inbound id onto Fastify request.id (so request.log uses it)', async () => {
      const app = Fastify({ logger: false });
      await app.register(correlationIdPlugin);

      let captured: string | undefined;
      app.get('/x', async (req) => {
        captured = req.id;
        return { ok: true };
      });

      await app.inject({
        method: 'GET',
        url: '/x',
        headers: { [CORRELATION_HEADER]: 'logged-id-7' },
      });

      expect(captured).toBe('logged-id-7');
    });
  });

  describe('mint on absent', () => {
    it('mints a ULID-shaped id when the inbound header is missing', async () => {
      const app = Fastify({ logger: false });
      await app.register(correlationIdPlugin);
      app.get('/x', async () => ({ ok: true }));

      const res = await app.inject({ method: 'GET', url: '/x' });

      expect(res.statusCode).toBe(200);
      const id = res.headers[CORRELATION_HEADER];
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    it('mints a new id when the inbound header is empty', async () => {
      const app = Fastify({ logger: false });
      await app.register(correlationIdPlugin);
      app.get('/x', async () => ({ ok: true }));

      const res = await app.inject({
        method: 'GET',
        url: '/x',
        headers: { [CORRELATION_HEADER]: '' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers[CORRELATION_HEADER]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    it('rejects unreasonably long inbound ids and mints a new one (DoS guard)', async () => {
      const app = Fastify({ logger: false });
      await app.register(correlationIdPlugin);
      app.get('/x', async () => ({ ok: true }));

      const tooLong = 'a'.repeat(1024);
      const res = await app.inject({
        method: 'GET',
        url: '/x',
        headers: { [CORRELATION_HEADER]: tooLong },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers[CORRELATION_HEADER]).not.toBe(tooLong);
      expect(res.headers[CORRELATION_HEADER]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });
  });

  describe('AsyncLocalStorage', () => {
    it('exposes the id via getCorrelationId() inside the handler', async () => {
      const app = Fastify({ logger: false });
      await app.register(correlationIdPlugin);

      let alsId: string | undefined;
      app.get('/x', async () => {
        alsId = getCorrelationId();
        return { ok: true };
      });

      await app.inject({
        method: 'GET',
        url: '/x',
        headers: { [CORRELATION_HEADER]: 'als-test-1' },
      });

      expect(alsId).toBe('als-test-1');
    });

    it('does not leak between parallel requests', async () => {
      const app = Fastify({ logger: false });
      await app.register(correlationIdPlugin);

      app.get('/x', async (_req) => {
        await new Promise((r) => setTimeout(r, 5));
        return { id: getCorrelationId() ?? null };
      });

      const [a, b] = await Promise.all([
        app.inject({
          method: 'GET',
          url: '/x',
          headers: { [CORRELATION_HEADER]: 'req-a' },
        }),
        app.inject({
          method: 'GET',
          url: '/x',
          headers: { [CORRELATION_HEADER]: 'req-b' },
        }),
      ]);

      expect(JSON.parse(a.body).id).toBe('req-a');
      expect(JSON.parse(b.body).id).toBe('req-b');
    });

    it('returns undefined outside any request context', () => {
      expect(getCorrelationId()).toBeUndefined();
    });

    it('runWithCorrelationId scopes the id to the callback', () => {
      let inside: string | undefined;
      runWithCorrelationId('manual-id', () => {
        inside = getCorrelationId();
      });
      expect(inside).toBe('manual-id');
      expect(getCorrelationId()).toBeUndefined();
    });
  });

  describe('outbound fetch wrapper', () => {
    it('injects x-correlation-id from ALS', async () => {
      const { fetchWithCorrelation } = await import('../src/http.js');

      const seen: { url: string; header: string | null }[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (input: any, init: any) => {
        const headers = new Headers(init?.headers);
        seen.push({ url: String(input), header: headers.get(CORRELATION_HEADER) });
        return new Response('{}', { status: 200 });
      };

      try {
        await runWithCorrelationId('outbound-1', async () => {
          await fetchWithCorrelation('http://example.test/a');
        });
        await fetchWithCorrelation('http://example.test/b');
      } finally {
        globalThis.fetch = realFetch;
      }

      expect(seen[0]).toEqual({ url: 'http://example.test/a', header: 'outbound-1' });
      expect(seen[1]).toEqual({ url: 'http://example.test/b', header: null });
    });

    it('does not overwrite an explicitly-set x-correlation-id', async () => {
      const { fetchWithCorrelation } = await import('../src/http.js');

      let captured: string | null = null;
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (_: any, init: any) => {
        captured = new Headers(init?.headers).get(CORRELATION_HEADER);
        return new Response('{}', { status: 200 });
      };

      try {
        await runWithCorrelationId('als-id', async () => {
          await fetchWithCorrelation('http://example.test', {
            headers: { [CORRELATION_HEADER]: 'explicit-id' },
          });
        });
      } finally {
        globalThis.fetch = realFetch;
      }

      expect(captured).toBe('explicit-id');
    });
  });
});
