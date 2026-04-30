// ─── Types ──────────────────────────────────────────────────────────
export type { BaseEntity, EntityStatus, ISODateTime, ULID } from './types/common.js';

export type {
  Org,
  Workspace,
  Room,
  RoomType,
  Agent,
  AgentStatus,
  Runtime,
  RuntimeStatus,
  RuntimeCapabilities,
  Package,
  PackageType,
  PackageDependency,
  PackagePermission,
  PackageCompatibility,
  Installation,
  InstallationStatus,
  Approval,
  ApprovalStatus,
  ApprovalDecision,
  ChannelBinding,
  ChannelType,
  WidgetInstance,
  MountPoint,
  Run,
  RunStatus,
  Artifact,
  ArtifactType,
} from './types/entities.js';

export type {
  PackageManifest,
  PackageManifestBase,
  PersonalityManifest,
  SkillManifest,
  MCPConnectorManifest,
  WorkflowManifest,
  TemplateManifest,
  PolicyManifest,
  WidgetManifest,
  OfficeManifest,
  ChannelManifest,
  OrchestratorManifest,
  RuntimeManifest,
  GooseRecipeManifest,
  InstallHooks,
} from './types/manifest.js';

// ─── Validators ─────────────────────────────────────────────────────
export {
  validateManifest,
  type ValidationResult,
  type ValidationError,
} from './validators/manifest-validator.js';

export {
  validateBaseEntity,
  isValidULID,
  isValidISODateTime,
  type EntityValidationResult,
} from './validators/entity-validator.js';
