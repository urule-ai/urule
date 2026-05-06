import { createEvent } from '../envelope.js';
import { AUDIT_TOPICS } from '../topics.js';
import type { AuditEvent } from '../events/audit.events.js';

/**
 * The actor whose action is being audited — set by the route handler
 * from `request.uruleUser` (or a service-account literal). Exported so
 * consumers can type their own helper wrappers around `AuditLogger`.
 */
export interface AuditActor {
  id: string;
  username: string;
}

export class AuditLogger {
  constructor(
    private serviceName: string,
    private publish: (topic: string, data: unknown) => void | Promise<void>,
  ) {}

  async entityCreated(actor: AuditActor, entityType: string, entityId: string, description: string, opts?: { workspaceId?: string; metadata?: Record<string, unknown> }) {
    await this.emit(AUDIT_TOPICS.ENTITY_CREATED, 'create', actor, entityType, entityId, description, opts);
  }

  async entityUpdated(actor: AuditActor, entityType: string, entityId: string, description: string, opts?: { workspaceId?: string; changes?: Record<string, { before?: unknown; after?: unknown }>; metadata?: Record<string, unknown> }) {
    await this.emit(AUDIT_TOPICS.ENTITY_UPDATED, 'update', actor, entityType, entityId, description, opts);
  }

  async entityDeleted(actor: AuditActor, entityType: string, entityId: string, description: string, opts?: { workspaceId?: string; metadata?: Record<string, unknown> }) {
    await this.emit(AUDIT_TOPICS.ENTITY_DELETED, 'delete', actor, entityType, entityId, description, opts);
  }

  async authLogin(actor: AuditActor, description: string, opts?: { metadata?: Record<string, unknown> }) {
    await this.emit(AUDIT_TOPICS.AUTH_LOGIN, 'login', actor, 'user', actor.id, description, opts);
  }

  async approvalDecided(actor: AuditActor, approvalId: string, decision: string, description: string, opts?: { workspaceId?: string; metadata?: Record<string, unknown> }) {
    await this.emit(AUDIT_TOPICS.APPROVAL_DECIDED, decision, actor, 'approval', approvalId, description, opts);
  }

  async accessDenied(actor: AuditActor, entityType: string, entityId: string, description: string, opts?: { metadata?: Record<string, unknown> }) {
    await this.emit(AUDIT_TOPICS.ACCESS_DENIED, 'access_denied', actor, entityType, entityId, description, opts);
  }

  async configChanged(actor: AuditActor, entityType: string, entityId: string, description: string, opts?: { workspaceId?: string; changes?: Record<string, { before?: unknown; after?: unknown }>; metadata?: Record<string, unknown> }) {
    await this.emit(AUDIT_TOPICS.CONFIG_CHANGED, 'config_changed', actor, entityType, entityId, description, opts);
  }

  private async emit(topic: string, action: string, actor: AuditActor, entityType: string, entityId: string, description: string, opts?: { workspaceId?: string; changes?: Record<string, { before?: unknown; after?: unknown }>; metadata?: Record<string, unknown> }) {
    const event = createEvent<AuditEvent>(topic, this.serviceName, {
      actorId: actor.id,
      actorName: actor.username,
      action,
      entityType,
      entityId,
      service: this.serviceName,
      workspaceId: opts?.workspaceId,
      description,
      changes: opts?.changes,
      metadata: opts?.metadata,
    });
    await this.publish(topic, event);
  }
}
