/**
 * Topic naming convention: urule.{domain}.{entity}.{action}
 *
 * Domains: registry, runtime, orchestrator, packages, approvals, channels, state, mcp
 */

// ─── Registry Events ───────────────────────────────────────────────

export const REGISTRY_TOPICS = {
  ORG_CREATED: 'urule.registry.org.created',
  ORG_UPDATED: 'urule.registry.org.updated',
  ORG_DELETED: 'urule.registry.org.deleted',

  WORKSPACE_CREATED: 'urule.registry.workspace.created',
  WORKSPACE_UPDATED: 'urule.registry.workspace.updated',
  WORKSPACE_DELETED: 'urule.registry.workspace.deleted',

  ROOM_CREATED: 'urule.registry.room.created',
  ROOM_UPDATED: 'urule.registry.room.updated',
  ROOM_DELETED: 'urule.registry.room.deleted',

  AGENT_REGISTERED: 'urule.registry.agent.registered',
  AGENT_UPDATED: 'urule.registry.agent.updated',
  AGENT_REMOVED: 'urule.registry.agent.removed',

  RUNTIME_REGISTERED: 'urule.registry.runtime.registered',
  RUNTIME_UPDATED: 'urule.registry.runtime.updated',
  RUNTIME_REMOVED: 'urule.registry.runtime.removed',
} as const;

// ─── Runtime Events ────────────────────────────────────────────────

export const RUNTIME_TOPICS = {
  SESSION_ALLOCATED: 'urule.runtime.session.allocated',
  SESSION_READY: 'urule.runtime.session.ready',
  SESSION_TERMINATED: 'urule.runtime.session.terminated',
  SESSION_ERROR: 'urule.runtime.session.error',
} as const;

// ─── Orchestrator Events ───────────────────────────────────────────

export const ORCHESTRATOR_TOPICS = {
  RUN_STARTED: 'urule.orchestrator.run.started',
  RUN_PAUSED: 'urule.orchestrator.run.paused',
  RUN_RESUMED: 'urule.orchestrator.run.resumed',
  RUN_COMPLETED: 'urule.orchestrator.run.completed',
  RUN_FAILED: 'urule.orchestrator.run.failed',
  RUN_CANCELLED: 'urule.orchestrator.run.cancelled',
  ARTIFACT_EMITTED: 'urule.orchestrator.artifact.emitted',
} as const;

// ─── Package Events ────────────────────────────────────────────────

export const PACKAGE_TOPICS = {
  INSTALLATION_CREATED: 'urule.packages.installation.created',
  INSTALLATION_COMPLETED: 'urule.packages.installation.completed',
  INSTALLATION_FAILED: 'urule.packages.installation.failed',
  UPGRADE_COMPLETED: 'urule.packages.upgrade.completed',
  UPGRADE_FAILED: 'urule.packages.upgrade.failed',
  UNINSTALL_COMPLETED: 'urule.packages.uninstall.completed',
  /**
   * Emitted (one event per outdated installation) when a workspace's
   * /updates endpoint is polled and the packages svc finds a newer
   * non-yanked version published in packagehub. office-ui consumes via
   * the §3.5 notification center; the event payload carries enough to
   * deep-link the user to the upgrade flow.
   */
  UPDATE_AVAILABLE: 'urule.packages.update.available',
} as const;

// ─── Approval Events ──────────────────────────────────────────────

export const APPROVAL_TOPICS = {
  APPROVAL_REQUESTED: 'urule.approvals.approval.requested',
  APPROVAL_DECIDED: 'urule.approvals.approval.decided',
  APPROVAL_ESCALATED: 'urule.approvals.approval.escalated',
  APPROVAL_EXPIRED: 'urule.approvals.approval.expired',
} as const;

// ─── Channel Events ───────────────────────────────────────────────

export const CHANNEL_TOPICS = {
  MESSAGE_RECEIVED: 'urule.channels.message.received',
  MESSAGE_DELIVERED: 'urule.channels.message.delivered',
  DELIVERY_FAILED: 'urule.channels.delivery.failed',
} as const;

// ─── State Events ─────────────────────────────────────────────────

export const STATE_TOPICS = {
  PRESENCE_CHANGED: 'urule.state.presence.changed',
  WIDGET_UPDATED: 'urule.state.widget.updated',
  TASK_OWNERSHIP_CHANGED: 'urule.state.task.ownership-changed',
} as const;

// ─── MCP Events ───────────────────────────────────────────────────

export const MCP_TOPICS = {
  SERVER_REGISTERED: 'urule.mcp.server.registered',
  SERVER_REMOVED: 'urule.mcp.server.removed',
  BINDING_CREATED: 'urule.mcp.binding.created',
  TOOL_INVOKED: 'urule.mcp.tool.invoked',
} as const;

// ─── Audit Events ────────────────────────────────────────────────

export const AUDIT_TOPICS = {
  ENTITY_CREATED: 'urule.audit.entity.created',
  ENTITY_UPDATED: 'urule.audit.entity.updated',
  ENTITY_DELETED: 'urule.audit.entity.deleted',
  AUTH_LOGIN: 'urule.audit.auth.login',
  AUTH_LOGOUT: 'urule.audit.auth.logout',
  APPROVAL_DECIDED: 'urule.audit.approval.decided',
  CONFIG_CHANGED: 'urule.audit.config.changed',
  ACCESS_DENIED: 'urule.audit.access.denied',
} as const;

/** All topic constants grouped by domain */
export const TOPICS = {
  registry: REGISTRY_TOPICS,
  runtime: RUNTIME_TOPICS,
  orchestrator: ORCHESTRATOR_TOPICS,
  packages: PACKAGE_TOPICS,
  approvals: APPROVAL_TOPICS,
  channels: CHANNEL_TOPICS,
  state: STATE_TOPICS,
  mcp: MCP_TOPICS,
  audit: AUDIT_TOPICS,
} as const;
