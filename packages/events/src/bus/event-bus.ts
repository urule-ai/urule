import {
  type NatsConnection,
  type Subscription,
  type JetStreamClient,
  type JetStreamManager,
  StringCodec,
  type ConsumerConfig,
  AckPolicy,
  headers as natsHeaders,
} from 'nats';
import { runWithCorrelationId } from '@urule/correlation-id';
import type { UruleEvent } from '../envelope.js';
import { createEvent } from '../envelope.js';

const sc = StringCodec();

const CORRELATION_HEADER = 'x-correlation-id';

export type EventHandler<T = unknown> = (event: UruleEvent<T>) => void | Promise<void>;

export interface EventBusSubscription {
  unsubscribe(): void;
}

export interface EventBusOptions {
  /** Service name, used as the event source */
  source: string;
  /** NATS JetStream stream name for durable subscriptions */
  streamName?: string;
  /** Subjects the stream should capture (defaults to "urule.>") */
  streamSubjects?: string[];
}

/**
 * Typed event bus wrapping NATS pub/sub.
 * Provides simple publish/subscribe with UruleEvent envelope.
 */
export class EventBus {
  private conn: NatsConnection;
  private source: string;
  private js: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;
  private streamName: string;
  private streamSubjects: string[];

  constructor(conn: NatsConnection, options: EventBusOptions) {
    this.conn = conn;
    this.source = options.source;
    this.streamName = options.streamName ?? 'URULE';
    this.streamSubjects = options.streamSubjects ?? ['urule.>'];
  }

  /**
   * Initialize JetStream for durable subscriptions.
   * Creates the stream if it doesn't exist.
   */
  async initJetStream(): Promise<void> {
    this.jsm = await this.conn.jetstreamManager();
    this.js = this.conn.jetstream();

    try {
      await this.jsm.streams.info(this.streamName);
    } catch {
      await this.jsm.streams.add({
        name: this.streamName,
        subjects: this.streamSubjects,
      });
    }
  }

  /**
   * Publish an event to a topic.
   */
  async publish<T>(topic: string, data: T, options?: { correlationId?: string; version?: number }): Promise<UruleEvent<T>> {
    const event = createEvent(topic, this.source, data, options);
    const payload = sc.encode(JSON.stringify(event));

    const hdrs = natsHeaders();
    hdrs.set(CORRELATION_HEADER, event.correlationId);

    if (this.js) {
      await this.js.publish(topic, payload, { headers: hdrs });
    } else {
      this.conn.publish(topic, payload, { headers: hdrs });
    }

    return event;
  }

  /**
   * Subscribe to a topic with a handler.
   * Uses core NATS (non-durable) subscription.
   * The handler runs inside an AsyncLocalStorage context tagged with the
   * incoming correlation ID, so downstream fetches/publishes inherit it.
   */
  subscribe<T = unknown>(topic: string, handler: EventHandler<T>): EventBusSubscription {
    const sub: Subscription = this.conn.subscribe(topic);

    (async () => {
      for await (const msg of sub) {
        try {
          const event = JSON.parse(sc.decode(msg.data)) as UruleEvent<T>;
          const id = msg.headers?.get(CORRELATION_HEADER) || event.correlationId;
          await runWithCorrelationId(id, () => handler(event));
        } catch (err) {
          console.error(`Error processing event on ${topic}:`, err);
        }
      }
    })();

    return {
      unsubscribe: () => sub.unsubscribe(),
    };
  }

  /**
   * Subscribe to a topic with a durable consumer (JetStream).
   * Messages are acknowledged after successful handler execution.
   * The handler runs inside an AsyncLocalStorage context tagged with the
   * incoming correlation ID, so downstream fetches/publishes inherit it.
   */
  async subscribeDurable<T = unknown>(
    topic: string,
    consumerName: string,
    handler: EventHandler<T>,
  ): Promise<EventBusSubscription> {
    if (!this.js || !this.jsm) {
      throw new Error('JetStream not initialized. Call initJetStream() first.');
    }

    const consumerConfig: Partial<ConsumerConfig> = {
      durable_name: consumerName,
      filter_subject: topic,
      ack_policy: AckPolicy.Explicit,
    };

    await this.jsm.consumers.add(this.streamName, consumerConfig);
    const consumer = await this.js.consumers.get(this.streamName, consumerName);
    const messages = await consumer.consume();

    (async () => {
      for await (const msg of messages) {
        try {
          const event = JSON.parse(sc.decode(msg.data)) as UruleEvent<T>;
          const id = msg.headers?.get(CORRELATION_HEADER) || event.correlationId;
          await runWithCorrelationId(id, () => handler(event));
          msg.ack();
        } catch (err) {
          console.error(`Error processing durable event on ${topic}:`, err);
          // Don't ack — message will be redelivered
        }
      }
    })();

    return {
      unsubscribe: () => messages.stop(),
    };
  }

  /**
   * Close the event bus connection.
   */
  async close(): Promise<void> {
    await this.conn.drain();
  }
}
