import type {
  InstallCommandOptions,
  Manifest,
  McpServerConfig,
  PluginEntry,
  RequiredEnv,
  ShareCommandOptions,
  SkillEntry
} from "../../types/index.ts";

export type LifecycleEvent =
  | "beforeShare"
  | "afterShare"
  | "beforeInstall"
  | "afterInstall"
  | (string & {});

export interface BeforeShareContext {
  manifest: Manifest;
  selectedServers: Record<string, McpServerConfig>;
  selectedSkills: SkillEntry[];
  selectedPlugins: (string | PluginEntry)[];
  redactedServers: Record<string, McpServerConfig>;
  requiredEnv: RequiredEnv[];
  options?: ShareCommandOptions;
  isAgentMode: boolean;
  isNonInteractive: boolean;
}

export interface AfterShareContext {
  manifest: Manifest;
  targetProvider: string;
  result?: unknown;
  url?: string;
  options?: ShareCommandOptions;
  isAgentMode: boolean;
  isNonInteractive: boolean;
}

export interface BeforeInstallContext {
  source: string;
  manifest: Manifest;
  targetAgentIds: string[];
  resolvedServers: Record<string, McpServerConfig>;
  options?: InstallCommandOptions;
  isAgentMode: boolean;
}

export interface AfterInstallContext {
  source: string;
  manifest: Manifest;
  targetAgentIds: string[];
  installedMcp: string[];
  installedSkills: string[];
  installedPlugins: string[];
  installedAgents?: string[];
  options?: InstallCommandOptions;
  isAgentMode: boolean;
}

export interface HookOptions {
  priority?: number;
}

export type HookFn<T = any> = (context: T) => Promise<void> | void;

export interface LifecycleEventMap {
  beforeShare: BeforeShareContext;
  afterShare: AfterShareContext;
  beforeInstall: BeforeInstallContext;
  afterInstall: AfterInstallContext;
  [event: string]: unknown;
}
