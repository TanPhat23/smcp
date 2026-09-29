import fs from "node:fs";
import { type AgentProfile, type DetectedAgent } from "../../types/index.ts";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { getAgentProfiles } from "./profiles.ts";

export function resolveActiveAgentPath(paths?: string[]): string | null {
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return null;
  }
  for (const p of paths) {
    try {
      const expanded = expandHome(p);
      if (fs.existsSync(expanded)) {
        return expanded;
      }
    } catch {
      // Ignore filesystem access errors
    }
  }
  return expandHome(paths[0]);
}

export function detectAgents(profiles?: Record<string, AgentProfile>): DetectedAgent[] {
  const activeProfiles = profiles || getAgentProfiles();
  const detected: DetectedAgent[] = [];

  for (const [id, profile] of Object.entries(activeProfiles)) {
    if (isPrototypePollutionKey(id)) continue;
    if (!profile || typeof profile !== "object") continue;

    let resolvedMcpPath: string | null = null;
    let resolvedSkillsPath: string | null = null;

    if (profile.mcpConfig && Array.isArray(profile.mcpConfig.paths)) {
      for (const p of profile.mcpConfig.paths) {
        try {
          const expanded = expandHome(p);
          if (fs.existsSync(expanded)) {
            const stat = fs.statSync(expanded);
            if (stat.isFile()) {
              resolvedMcpPath = expanded;
              break;
            }
          }
        } catch {
          // Ignore path access error
        }
      }
    }

    if (profile.skills && Array.isArray(profile.skills.paths)) {
      for (const p of profile.skills.paths) {
        try {
          const expanded = expandHome(p);
          if (fs.existsSync(expanded)) {
            const stat = fs.statSync(expanded);
            if (stat.isDirectory()) {
              resolvedSkillsPath = expanded;
              break;
            }
          }
        } catch {
          // Ignore path access error
        }
      }
    }

    let resolvedPluginsConfigPath: string | null = null;
    let resolvedPluginsDirPath: string | null = null;

    if (profile.plugins && Array.isArray(profile.plugins.paths)) {
      for (const p of profile.plugins.paths) {
        try {
          const expanded = expandHome(p);
          if (fs.existsSync(expanded)) {
            const stat = fs.statSync(expanded);
            if (stat.isFile()) {
              resolvedPluginsConfigPath = expanded;
              break;
            }
          }
        } catch {
          // Ignore path access error
        }
      }
    }

    if (profile.plugins && Array.isArray(profile.plugins.dirPaths)) {
      for (const p of profile.plugins.dirPaths) {
        try {
          const expanded = expandHome(p);
          if (fs.existsSync(expanded)) {
            const stat = fs.statSync(expanded);
            if (stat.isDirectory()) {
              resolvedPluginsDirPath = expanded;
              break;
            }
          }
        } catch {
          // Ignore path access error
        }
      }
    }

    if (resolvedMcpPath || resolvedSkillsPath || resolvedPluginsConfigPath) {
      detected.push({
        id,
        name: profile.name,
        mcpConfigPath: resolvedMcpPath,
        skillsDirPath: resolvedSkillsPath,
        pluginsConfigPath: resolvedPluginsConfigPath,
        pluginsDirPath: resolvedPluginsDirPath
      });
    }
  }

  return detected;
}
