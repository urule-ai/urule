import { describe, it, expect } from 'vitest';
import { headers as natsHeaders, StringCodec, type NatsConnection, type Subscription } from 'nats';
import { EventBus } from '../src/bus/event-bus.js';
import { getCorrelationId, runWithCorrelationId } from '@urule/correlation-id';

const sc = StringCodec();

function makeMockConn(): {
  conn: NatsConnection;
  published: Array<{ subject: string; data: Uint8Array; headerId: string | null }>;
  emit: (subject: string, data: Uint8Array, headerId?: string) => void;
} {
  const published: Array<{ subject: string; data: Uint8Array; headerId: string | null }> = [];
  const subs = new Map<string, Array<(msg: { data: Uint8Array; headers?: { get: (k: string) => string } }) => void>>();

  const conn = {
    publish(subject: string, data: Uint8Array, opts?: { headers?: { get(k: string): string } }) {
      published.push({
        subject,
        data,
        headerId: opts?.headers?.get('x-correlation-id') ?? null,
      });
    },
    subscribe(subject: string): Subscription {
      let pending: Array<{ data: Uint8Array; headers?: { get: (k: string) => string } }> = [];
      let resolveNext: ((v: IteratorResult<{ data: Uint8Array; headers?: { get: (k: string) => string } }>) => void) | null = null;
      let stopped = false;

      const onMsg = (msg: { data: Uint8Array; headers?: { get: (k: string) => string } }) => {
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r({ value: msg, done: false });
        } else {
          pending.push(msg);
        }
      };

      const list = subs.get(subject) ?? [];
      list.push(onMsg);
      subs.set(subject, list);

      return {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<unknown>> {
              if (stopped) return Promise.resolve({ value: undefined, done: true });
              if (pending.length > 0) {
                return Promise.resolve({ value: pending.shift()!, done: false });
              }
              return new Promise((resolve) => {
                resolveNext = resolve as never;
              });
            },
          } as never;
        },
        unsubscribe() {
          stopped = true;
          if (resolveNext) resolveNext({ value: undefined, done: true } as never);
        },
      } as unknown as Subscription;
    },
  } as unknown as NatsConnection;

  return {
    conn,
    published,
    emit(subject, data, headerId) {
      const hdrs = headerId ? { get: (k: string) => (k === 'x-correlation-id' ? headerId : '') } : undefined;
      const list = subs.get(subject) ?? [];
      for (const fn of list) fn({ data, headers: hdrs });
    },
  };
}

describe('EventBus correlation ID propagation', () => {
  it('publish() sets x-correlation-id NATS header from explicit option', async () => {
    const mock = makeMockConn();
    const bus = new EventBus(mock.conn, { source: 'test-svc' });

    const event = await bus.publish('urule.test.thing', { ok: 1 }, { correlationId: 'explicit-1' });

    expect(event.correlationId).toBe('explicit-1');
    expect(mock.published.length).toBe(1);
    expect(mock.published[0].headerId).toBe('explicit-1');
    expect(mock.published[0].subject).toBe('urule.test.thing');
  });

  it('publish() falls back to ALS correlation id when no option is passed', async () => {
    const mock = makeMockConn();
    const bus = new EventBus(mock.conn, { source: 'test-svc' });

    await runWithCorrelationId('als-source', async () => {
      await bus.publish('urule.test.thing', { ok: 1 });
    });

    expect(mock.published[0].headerId).toBe('als-source');
  });

  it('publish() falls back to ulid when neither option nor ALS is set', async () => {
    const mock = makeMockConn();
    const bus = new EventBus(mock.conn, { source: 'test-svc' });

    const event = await bus.publish('urule.test.thing', { ok: 1 });

    expect(event.correlationId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(mock.published[0].headerId).toBe(event.correlationId);
  });

  it('subscribe() runs handler in ALS context tagged with the inbound header', async () => {
    const mock = makeMockConn();
    const bus = new EventBus(mock.conn, { source: 'test-svc' });

    let alsInsideHandler: string | undefined;
    const done = new Promise<void>((resolve) => {
      bus.subscribe('urule.test.thing', () => {
        alsInsideHandler = getCorrelationId();
        resolve();
      });
    });

    const fakeEvent = {
      id: 'evt-1',
      type: 'urule.test.thing',
      source: 'remote',
      timestamp: new Date().toISOString(),
      version: 1,
      correlationId: 'envelope-fallback',
      data: {},
    };
    mock.emit('urule.test.thing', sc.encode(JSON.stringify(fakeEvent)), 'header-id');

    await done;
    expect(alsInsideHandler).toBe('header-id');
  });

  it('subscribe() falls back to envelope.correlationId when no NATS header is present', async () => {
    const mock = makeMockConn();
    const bus = new EventBus(mock.conn, { source: 'test-svc' });

    let alsInsideHandler: string | undefined;
    const done = new Promise<void>((resolve) => {
      bus.subscribe('urule.test.thing', () => {
        alsInsideHandler = getCorrelationId();
        resolve();
      });
    });

    const fakeEvent = {
      id: 'evt-2',
      type: 'urule.test.thing',
      source: 'remote',
      timestamp: new Date().toISOString(),
      version: 1,
      correlationId: 'envelope-only',
      data: {},
    };
    mock.emit('urule.test.thing', sc.encode(JSON.stringify(fakeEvent))); // no header

    await done;
    expect(alsInsideHandler).toBe('envelope-only');
  });
});
