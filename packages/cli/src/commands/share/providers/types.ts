import type {
  Manifest,
  McpServerConfig,
  PluginEntry,
  ScannedAgentEntry,
  ShareCommandOptions,
  SkillEntry
} from "@tanphat/smcp-core";

export interface ShareProviderContext {
  manifest: Manifest;
  bundledSkills: SkillEntry[];
  bundledPlugins: PluginEntry[];
  bundledAgents?: Array<ScannedAgentEntry & { rawContent: string }>;
  redactedServers: Record<string, McpServerConfig>;
  selectedServers: Record<string, McpServerConfig>;
  selectedSkills: SkillEntry[];
  selectedPlugins: PluginEntry[];
  selectedAgents?: ScannedAgentEntry[];
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
