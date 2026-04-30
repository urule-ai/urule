// ─── Envelope ───────────────────────────────────────────────────────
export { createEvent, type UruleEvent } from './envelope.js';

// ─── Topics ─────────────────────────────────────────────────────────
export {
  TOPICS,
  REGISTRY_TOPICS,
  RUNTIME_TOPICS,
  ORCHESTRATOR_TOPICS,
  PACKAGE_TOPICS,
  APPROVAL_TOPICS,
  CHANNEL_TOPICS,
  STATE_TOPICS,
  MCP_TOPICS,
  AUDIT_TOPICS,
} from './topics.js';

// ─── Event Bus ──────────────────────────────────────────────────────
export { EventBus, type EventHandler, type EventBusSubscription, type EventBusOptions } from './bus/event-bus.js';
export { createEventBus, type ConnectOptions } from './bus/connection.js';

// ─── Event Payloads ─────────────────────────────────────────────────
export type {
  OrgCreatedEvent,
  OrgUpdatedEvent,
  OrgDeletedEvent,
  WorkspaceCreatedEvent,
  WorkspaceUpdatedEvent,
  WorkspaceDeletedEvent,
  RoomCreatedEvent,
  AgentRegisteredEvent,
  AgentUpdatedEvent,
  RuntimeRegisteredEvent,
} from './events/registry.events.js';

export type {
  RunStartedEvent,
  RunPausedEvent,
  RunResumedEvent,
  RunCompletedEvent,
  RunFailedEvent,
  RunCancelledEvent,
  ArtifactEmittedEvent,
} from './events/orchestrator.events.js';

export type {
  SessionAllocatedEvent,
  SessionReadyEvent,
  SessionTerminatedEvent,
  SessionErrorEvent,
} from './events/runtime.events.js';

export type { AuditEvent } from './events/audit.events.js';

// ─── Audit Logger ──────────────────────────────────────────────────
export { AuditLogger } from './audit/audit-logger.js';

// ─── Idempotency ────────────────────────────────────────────────────
export { generateIdempotencyKey, deterministicKey } from './idempotency/key-generator.js';

// ─── Redaction ──────────────────────────────────────────────────────
export { redactSecrets } from './redaction/redact-secrets.js';
