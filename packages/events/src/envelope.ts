import { ulid } from 'ulid';
import { getCorrelationId } from '@urule/correlation-id';

/** Event envelope that wraps all Urule domain events */
export interface UruleEvent<T = unknown> {
  /** Unique event ID (ULID) */
  id: string;
  /** Event type, e.g. "urule.registry.workspace.created" */
  type: string;
  /** Service that emitted the event */
  source: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Schema version of this event type */
  version: number;
  /** Correlation ID for tracing across services */
  correlationId: string;
  /** The event payload */
  data: T;
}

/** Creates a new event envelope */
export function createEvent<T>(
  type: string,
  source: string,
  data: T,
  options?: { correlationId?: string; version?: number },
): UruleEvent<T> {
  return {
    id: ulid(),
    type,
    source,
    timestamp: new Date().toISOString(),
    version: options?.version ?? 1,
    correlationId: options?.correlationId ?? getCorrelationId() ?? ulid(),
    data,
  };
}
