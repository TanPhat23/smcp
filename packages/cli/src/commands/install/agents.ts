import {
  getAgentProfiles,
  installPluginFiles,
  installSkillFiles,
  mergeMcpServersIntoFile,
  mergePluginsIntoFile,
  resolveActiveAgentPath,
  type AgentProfile,
  type Manifest,
  type McpServerConfig
} from "@tanphat/smcp-core";
import { extractPluginFiles, extractSkillFiles } from "./extract.ts";

export { resolveActiveAgentPath };
export const resolveActivePath = resolveActiveAgentPath;

export function installPackIntoAgents(
  manifest: Manifest,
  targetAgentIds: string[],
  resolvedServers: Record<string, McpServerConfig>,
  rawFiles?: Record<string, string>,
  localDir?: string,
  profiles?: Record<string, AgentProfile>,
  customPluginDir?: string
): { installedMcp: string[]; installedSkills: string[]; installedPlugins: string[] } {
  const activeProfiles = profiles || getAgentProfiles();
  const installedMcp: string[] = [];
  const installedSkills: string[] = [];
  const installedPlugins: string[] = [];

  for (const agentId of targetAgentIds) {
    const profile = activeProfiles[agentId];
    if (!profile) continue;

    // Install MCP servers
    if (
      profile.mcpConfig &&
      profile.mcpConfig.paths &&
      profile.mcpConfig.paths.length > 0 &&
      Object.keys(resolvedServers).length > 0
    ) {
      const primaryPath = resolveActiveAgentPath(profile.mcpConfig.paths);
      if (primaryPath) {
        mergeMcpServersIntoFile(primaryPath, resolvedServers, {
          mcpKey: profile.mcpConfig.key || "mcpServers",
          format: profile.mcpConfig.format,
          agentId
        });
        installedMcp.push(agentId);
      }
    }

    // Install Skills
    if (
      profile.skills &&
      profile.skills.paths &&
      profile.skills.paths.length > 0 &&
      manifest.skills &&
      manifest.skills.length > 0
    ) {
      const primarySkillsDir = resolveActiveAgentPath(profile.skills.paths);
      if (primarySkillsDir) {
        for (const skill of manifest.skills) {
          const filesToInstall = extractSkillFiles(skill, rawFiles, localDir);
          installSkillFiles(primarySkillsDir, skill.name, filesToInstall);
        }
        installedSkills.push(agentId);
      }
    }

    // Install Plugins
    if (
      profile.plugins &&
      profile.plugins.paths &&
      profile.plugins.paths.length > 0 &&
      manifest.plugins &&
      manifest.plugins.length > 0
    ) {
      const primaryPluginsConfig = resolveActiveAgentPath(profile.plugins.paths);
      if (primaryPluginsConfig) {
        const compatiblePlugins = manifest.plugins.filter((pl) => {
          if (typeof pl === "string") return true;
          if (!pl.targetAgent) return true;
          if (pl.targetAgent === agentId) return true;
          if (
            pl.targetAgent === "opencode" &&
            (agentId === "opencode" || agentId.includes("opencode") || profile.plugins?.format === "array")
          ) {
            return true;
          }
          if (
            pl.targetAgent === "claude-code" &&
            (agentId === "claude-code" || agentId.startsWith("claude") || agentId.includes("claude") || profile.plugins?.format === "map")
          ) {
            return true;
          }
          return false;
        });

        if (compatiblePlugins.length > 0) {
          mergePluginsIntoFile(
            primaryPluginsConfig,
            compatiblePlugins,
            profile.plugins.key || "plugin",
            profile.plugins.format || "array"
          );

          // Extract any local plugin files if present
          const destPluginDir =
            customPluginDir ||
            (profile.plugins.dirPaths ? resolveActiveAgentPath(profile.plugins.dirPaths) : undefined) ||
            "./plugin";

          for (const pl of compatiblePlugins) {
            const files = extractPluginFiles(pl, rawFiles, localDir);
            if (Object.keys(files).length > 0) {
              const pName = typeof pl === "string" ? pl : pl.name;
              installPluginFiles(destPluginDir, pName, files);
            }
          }

          installedPlugins.push(agentId);
        }
      }
    }
  }

  return { installedMcp, installedSkills, installedPlugins };
}
