import type { PackageCompatibility, PackageDependency, PackagePermission, PackageType } from './entities.js';

/** Install hook definitions */
export interface InstallHooks {
  preInstall?: string;
  postInstall?: string;
  preUninstall?: string;
  postUninstall?: string;
}

/** Base manifest fields shared by all package types */
export interface PackageManifestBase {
  name: string;
  version: string;
  type: PackageType;
  description: string;
  author: string;
  license: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  dependencies?: PackageDependency[];
  permissions?: PackagePermission[];
  compatibility?: PackageCompatibility;
  hooks?: InstallHooks;
  signatures?: string[];
}

// ─── Type-specific manifest extensions ─────────────────────────────

export interface PersonalityManifest extends PackageManifestBase {
  type: 'personality';
  personality: {
    systemPrompt: string;
    goals?: string[];
    defaultTools?: string[];
    memoryRules?: Record<string, unknown>;
    operatingStyle?: string;
  };
}

export interface SkillManifest extends PackageManifestBase {
  type: 'skill';
  skill: {
    tools: string[];
    description: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  };
}

export interface MCPConnectorManifest extends PackageManifestBase {
  type: 'mcp_connector';
  mcpConnector: {
    serverCommand: string;
    serverArgs?: string[];
    env?: Record<string, string>;
    tools?: string[];
    resources?: string[];
    authType?: 'none' | 'api_key' | 'oauth2';
  };
}

export interface WorkflowManifest extends PackageManifestBase {
  type: 'workflow';
  workflow: {
    temporalWorkflowId: string;
    taskQueue: string;
    inputSchema?: Record<string, unknown>;
    triggers?: string[];
  };
}

export interface TemplateManifest extends PackageManifestBase {
  type: 'template';
  template: {
    agents: string[];
    skills: string[];
    connectors: string[];
    workflows?: string[];
    policies?: string[];
    widgets?: string[];
  };
}

export interface PolicyManifest extends PackageManifestBase {
  type: 'policy';
  policy: {
    rules: string[];
    engine: 'opa' | 'openfga';
    scope: 'workspace' | 'org' | 'global';
  };
}

export interface WidgetManifest extends PackageManifestBase {
  type: 'widget';
  widget: {
    entrypoint: string;
    mountPoints: string[];
    dimensions?: { width: number; height: number };
  };
}

export interface OfficeManifest extends PackageManifestBase {
  type: 'office';
  office: {
    mapFile: string;
    rooms: string[];
    theme?: string;
    avatarSkins?: string[];
  };
}

export interface ChannelManifest extends PackageManifestBase {
  type: 'channel';
  channel: {
    channelType: string;
    adapterEntrypoint: string;
    configSchema?: Record<string, unknown>;
  };
}

export interface OrchestratorManifest extends PackageManifestBase {
  type: 'orchestrator';
  orchestrator: {
    adapterEntrypoint: string;
    capabilities: string[];
  };
}

export interface RuntimeManifest extends PackageManifestBase {
  type: 'runtime';
  runtime: {
    image?: string;
    profile: string;
    capabilities: string[];
  };
}

export interface GooseRecipeManifest extends PackageManifestBase {
  type: 'goose_recipe';
  gooseRecipe: {
    recipePath: string;
    defaultModel?: string;
    defaultProvider?: string;
    extensions?: string[];
    parameters?: Record<string, unknown>;
  };
}

/** Union of all package manifest types */
export type PackageManifest =
  | PersonalityManifest
  | SkillManifest
  | MCPConnectorManifest
  | WorkflowManifest
  | TemplateManifest
  | PolicyManifest
  | WidgetManifest
  | OfficeManifest
  | ChannelManifest
  | OrchestratorManifest
  | RuntimeManifest
  | GooseRecipeManifest;
