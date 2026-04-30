import type { BaseEntity, EntityStatus, ISODateTime, ULID } from './common.js';

// ─── Org ───────────────────────────────────────────────────────────

export interface Org extends BaseEntity {
  name: string;
  slug: string;
  status: EntityStatus;
}

// ─── Workspace ─────────────────────────────────────────────────────

export interface Workspace extends BaseEntity {
  orgId: ULID;
  name: string;
  slug: string;
  description: string;
  status: EntityStatus;
}

// ─── Room ──────────────────────────────────────────────────────────

export type RoomType = 'general' | 'project' | 'support' | 'private' | 'lobby';

export interface Room extends BaseEntity {
  workspaceId: ULID;
  name: string;
  type: RoomType;
  config: Record<string, unknown>;
}

// ─── Agent ─────────────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'busy' | 'offline' | 'error';

export interface Agent extends BaseEntity {
  workspaceId: ULID;
  name: string;
  description: string;
  personalityPackId?: ULID;
  skillPacks: ULID[];
  mcpBindings: ULID[];
  status: AgentStatus;
  config: Record<string, unknown>;
}

// ─── Runtime ───────────────────────────────────────────────────────

export type RuntimeStatus = 'available' | 'allocated' | 'running' | 'terminated' | 'error';

export interface RuntimeCapabilities {
  hasGpu: boolean;
  hasBrowser: boolean;
  hasNetwork: boolean;
  maxConcurrentTasks: number;
}

export interface Runtime extends BaseEntity {
  workspaceId: ULID;
  provider: string;
  profile: string;
  status: RuntimeStatus;
  capabilities: RuntimeCapabilities;
  sessionId?: string;
}

// ─── Package & Installation ────────────────────────────────────────

export type PackageType =
  | 'personality'
  | 'skill'
  | 'mcp_connector'
  | 'workflow'
  | 'template'
  | 'policy'
  | 'widget'
  | 'office'
  | 'channel'
  | 'orchestrator'
  | 'runtime'
  | 'goose_recipe';

export interface PackageDependency {
  packageName: string;
  versionRange: string;
}

export interface PackagePermission {
  resource: string;
  level: 'required' | 'optional';
}

export interface PackageCompatibility {
  uruleVersion?: string;
  runtimes?: string[];
  orchestrators?: string[];
}

export interface Package extends BaseEntity {
  name: string;
  version: string;
  type: PackageType;
  description: string;
  author: string;
  license: string;
  dependencies: PackageDependency[];
  permissions: PackagePermission[];
  compatibility: PackageCompatibility;
  signatures?: string[];
  config: Record<string, unknown>;
}

export type InstallationStatus = 'pending' | 'installing' | 'installed' | 'failed' | 'uninstalling';

export interface Installation extends BaseEntity {
  workspaceId: ULID;
  packageId: ULID;
  version: string;
  status: InstallationStatus;
  installedAt?: ISODateTime;
  config: Record<string, unknown>;
}

// ─── Approval ──────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
export type ApprovalDecision = 'approve' | 'reject';

export interface Approval extends BaseEntity {
  workspaceId: ULID;
  runId?: ULID;
  type: string;
  title: string;
  description: string;
  status: ApprovalStatus;
  requestedBy: ULID;
  approvers: ULID[];
  decidedBy?: ULID;
  decision?: ApprovalDecision;
  decidedAt?: ISODateTime;
  expiresAt?: ISODateTime;
  context: Record<string, unknown>;
}

// ─── Channel Binding ───────────────────────────────────────────────

export type ChannelType = 'slack' | 'telegram' | 'email' | 'discord' | 'internal';

export interface ChannelBinding extends BaseEntity {
  workspaceId: ULID;
  channelType: ChannelType;
  externalChannelId: string;
  config: Record<string, unknown>;
}

// ─── Widget Instance ───────────────────────────────────────────────

export type MountPoint =
  | 'office_panel'
  | 'office_overlay'
  | 'admin_dashboard'
  | 'agent_inspector'
  | 'approval_inbox'
  | 'package_detail';

export interface WidgetInstance extends BaseEntity {
  workspaceId: ULID;
  packageId: ULID;
  mountPoint: MountPoint;
  config: Record<string, unknown>;
}

// ─── Run & Artifact ────────────────────────────────────────────────

export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface Run extends BaseEntity {
  workspaceId: ULID;
  agentId: ULID;
  orchestratorType: string;
  status: RunStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: ISODateTime;
  completedAt?: ISODateTime;
}

export type ArtifactType = 'file' | 'log' | 'transcript' | 'summary' | 'data';

export interface Artifact extends BaseEntity {
  runId: ULID;
  type: ArtifactType;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
  content?: string;
  metadata: Record<string, unknown>;
}
