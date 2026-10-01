import fs from "node:fs";
import path from "node:path";
import { getAgentProfiles } from "../agents/profiles.ts";
import { isStrictlyInside } from "./helpers.ts";
import { expandHome } from "../../utils/paths.ts";
import { stripJsonComments } from "../agents/index.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { resolveActiveAgentPath } from "../agents/detector.ts";
import type { AgentProfile, InstalledPackRecord } from "../../types/index.ts";

export interface UninstallResult {
  removedMcp: string[];
  removedSkills: string[];
  removedPlugins: string[];
}

export function uninstallPackFromAgents(
  record: InstalledPackRecord,
  profiles?: Record<string, AgentProfile>
): UninstallResult {
  const activeProfiles = profiles || getAgentProfiles();
  const removedMcp: string[] = [];
  const removedSkills: string[] = [];
  const removedPlugins: string[] = [];

  const targetAgentIds = record.targetAgents || [];

  for (const agentId of targetAgentIds) {
    const profile = activeProfiles[agentId];
    if (!profile) continue;

    // 1. Remove MCP servers from agent config file
    if (
      profile.mcpConfig &&
      profile.mcpConfig.paths &&
      profile.mcpConfig.paths.length > 0 &&
      record.installedMcp &&
      record.installedMcp.length > 0
    ) {
      const activePath = resolveActiveAgentPath(profile.mcpConfig.paths);
      if (activePath && fs.existsSync(activePath)) {
        try {
          const raw = fs.readFileSync(activePath, "utf8");
          const config = JSON.parse(stripJsonComments(raw));

          let modified = false;

          // Check OpenCode V2 format (mcp.servers)
          if (
            config.mcp &&
            typeof config.mcp === "object" &&
            !Array.isArray(config.mcp) &&
            config.mcp.servers &&
            typeof config.mcp.servers === "object" &&
            !Array.isArray(config.mcp.servers)
          ) {
            for (const sName of record.installedMcp) {
              if (config.mcp.servers[sName]) {
                delete config.mcp.servers[sName];
                modified = true;
                if (!removedMcp.includes(sName)) removedMcp.push(sName);
              }
            }
          }

          // Check standard format (mcpServers or profile.mcpConfig.key)
          const targetKey = profile.mcpConfig.key || "mcpServers";
          if (
            config[targetKey] &&
            typeof config[targetKey] === "object" &&
            !Array.isArray(config[targetKey])
          ) {
            for (const sName of record.installedMcp) {
              if (config[targetKey][sName]) {
                delete config[targetKey][sName];
                modified = true;
                if (!removedMcp.includes(sName)) removedMcp.push(sName);
              }
            }
          }

          if (modified) {
            fs.writeFileSync(activePath, JSON.stringify(config, null, 2), "utf8");
          }
        } catch {
          // Ignore parse errors on uninstall
        }
      }
    }

    // 2. Remove skills directories
    if (
      profile.skills &&
      profile.skills.paths &&
      profile.skills.paths.length > 0 &&
      record.installedSkills &&
      record.installedSkills.length > 0
    ) {
      const activeSkillsDir = resolveActiveAgentPath(profile.skills.paths);
      if (activeSkillsDir && fs.existsSync(activeSkillsDir)) {
        const canonicalBase = fs.realpathSync(activeSkillsDir);
        for (const skillName of record.installedSkills) {
          if (!skillName || isPrototypePollutionKey(skillName)) continue;
          const targetDir = path.resolve(activeSkillsDir, skillName);
          if (fs.existsSync(targetDir)) {
            try {
              const realTarget = fs.realpathSync(targetDir);
              if (isStrictlyInside(canonicalBase, realTarget)) {
                fs.rmSync(realTarget, { recursive: true, force: true });
                if (!removedSkills.includes(skillName)) removedSkills.push(skillName);
              }
            } catch {
              // Ignore removal failure
            }
          }
        }
      }
    }

    // 3. Remove plugin files
    if (
      profile.plugins &&
      profile.plugins.dirPaths &&
      profile.plugins.dirPaths.length > 0 &&
      record.installedPlugins &&
      record.installedPlugins.length > 0
    ) {
      const activePluginsDir = resolveActiveAgentPath(profile.plugins.dirPaths);
      if (activePluginsDir && fs.existsSync(activePluginsDir)) {
        const canonicalBase = fs.realpathSync(activePluginsDir);
        for (const pluginName of record.installedPlugins) {
          if (!pluginName || isPrototypePollutionKey(pluginName)) continue;
          const targetFile = path.resolve(activePluginsDir, pluginName);
          if (fs.existsSync(targetFile)) {
            try {
              const realTarget = fs.realpathSync(targetFile);
              if (isStrictlyInside(canonicalBase, realTarget)) {
                fs.rmSync(realTarget, { force: true });
                if (!removedPlugins.includes(pluginName)) removedPlugins.push(pluginName);
              }
            } catch {
              // Ignore removal failure
            }
          }
        }
      }
    }
  }

  return { removedMcp, removedSkills, removedPlugins };
}
