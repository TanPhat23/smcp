import type {
  Manifest,
  McpServerConfig,
  PluginEntry,
  ShareCommandOptions,
  SkillEntry
} from "@tanphat/core";

export interface ShareProviderContext {
  manifest: Manifest;
  bundledSkills: SkillEntry[];
  bundledPlugins: PluginEntry[];
  redactedServers: Record<string, McpServerConfig>;
  selectedServers: Record<string, McpServerConfig>;
  selectedSkills: SkillEntry[];
  selectedPlugins: PluginEntry[];
  gistFiles: Record<string, { content: string }>;
  options?: ShareCommandOptions;
  isNonInteractive: boolean;
  isAgentMode: boolean;
  version: string;
  cleanPackName: string;
  cleanPackDesc: string;
  targetGistId?: string;
  targetRepoInput?: string;
  targetLocalOutDir?: string;
}

export interface ShareProvider {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  publish(context: ShareProviderContext): Promise<boolean | void>;
}
