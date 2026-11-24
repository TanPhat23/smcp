import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAgentProfiles } from "../agents/profiles.ts";
import { isStrictlyInside } from "./helpers.ts";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import { expandHome } from "../../utils/paths.ts";
import { stripJsonComments } from "../agents/index.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { resolveActiveAgentPath, isGlobalConfigPath } from "../agents/detector.ts";
import type { AgentProfile, InstalledPackRecord } from "../../types/index.ts";

export interface UninstallResult {
  removedMcp: string[];
  removedSkills: string[];
  removedPlugins: string[];
  removedAgents: string[];
}

export function uninstallPackFromAgents(
  record: InstalledPackRecord,
  profiles?: Record<string, AgentProfile>
): UninstallResult {
  const activeProfiles = profiles || getAgentProfiles();
  const removedMcp: string[] = [];
  const removedSkills: string[] = [];
  const removedPlugins: string[] = [];
  const removedAgents: string[] = [];

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
      // Install may have written to any scope, so check every candidate file.
      const candidatePaths = new Set<string>();
      for (const scope of ["global", "project"] as const) {
        const resolved = resolveActiveAgentPath(profile.mcpConfig.paths, { scope });
        if (resolved) candidatePaths.add(resolved);
      }
      for (const p of profile.mcpConfig.paths) {
        candidatePaths.add(isGlobalConfigPath(p) ? expandHome(p) : path.resolve(p));
      }
      const targetKey = profile.mcpConfig.key || "mcpServers";

      for (const activePath of candidatePaths) {
        if (!fs.existsSync(activePath)) continue;
        try {
          const writePath = fs.realpathSync(activePath);
          const raw = fs.readFileSync(writePath, "utf8");
          const config = JSON.parse(stripJsonComments(raw));
          if (!config || typeof config !== "object" || Array.isArray(config)) continue;

          let modified = false;
          const removeFrom = (map: unknown) => {
            if (!map || typeof map !== "object" || Array.isArray(map)) return;
            for (const sName of record.installedMcp) {
              if (isPrototypePollutionKey(sName)) continue;
              if (Object.hasOwn(map, sName)) {
                delete (map as Record<string, unknown>)[sName];
                modified = true;
                if (!removedMcp.includes(sName)) removedMcp.push(sName);
              }
            }
          };

          // OpenCode V2 format (mcp.servers)
          if (config.mcp && typeof config.mcp === "object" && !Array.isArray(config.mcp)) {
            removeFrom(config.mcp.servers);
          }
          // Standard format (mcpServers or profile.mcpConfig.key)
          removeFrom(config[targetKey]);
          // Claude Code per-project servers inside ~/.claude.json
          if (config.projects && typeof config.projects === "object" && !Array.isArray(config.projects)) {
            for (const dir of new Set([process.cwd(), os.homedir()])) {
              if (Object.hasOwn(config.projects, dir)) {
                removeFrom(config.projects[dir]?.mcpServers);
              }
            }
          }

          if (modified) {
            atomicWriteFileSync(writePath, JSON.stringify(config, null, 2) + "\n");
          }
        } catch {
          // Ignore parse errors on uninstall: never rewrite a file we can't parse
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

    // 3a. Remove enabled-plugin map entries (e.g. Claude Code enabledPlugins)
    if (
      profile.plugins &&
      profile.plugins.format === "map" &&
      profile.plugins.paths &&
      record.installedPlugins &&
      record.installedPlugins.length > 0
    ) {
      const mapKey = profile.plugins.key || "enabledPlugins";
      for (const p of profile.plugins.paths) {
        const file = isGlobalConfigPath(p) ? expandHome(p) : path.resolve(p);
        if (!fs.existsSync(file)) continue;
        try {
          const writePath = fs.realpathSync(file);
          const config = JSON.parse(stripJsonComments(fs.readFileSync(writePath, "utf8")));
          const map = config?.[mapKey];
          if (!map || typeof map !== "object" || Array.isArray(map)) continue;
          let modified = false;
          for (const name of record.installedPlugins) {
            if (isPrototypePollutionKey(name)) continue;
            if (Object.hasOwn(map, name)) {
              delete map[name];
              modified = true;
              if (!removedPlugins.includes(name)) removedPlugins.push(name);
            }
          }
          if (modified) atomicWriteFileSync(writePath, JSON.stringify(config, null, 2) + "\n");
        } catch {
          // Ignore parse errors on uninstall
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

    // 4. Remove agent files
    if (
      profile.agents &&
      profile.agents.paths &&
      profile.agents.paths.length > 0 &&
      record.installedAgents &&
      record.installedAgents.length > 0
    ) {
      for (const p of profile.agents.paths) {
        const candidateDir = isGlobalConfigPath(p) ? expandHome(p) : path.resolve(p);
        if (fs.existsSync(candidateDir)) {
          try {
            const canonicalBase = fs.realpathSync(candidateDir);
            for (const agentName of record.installedAgents) {
              if (!agentName || isPrototypePollutionKey(agentName)) continue;
              const fileCandidates = [
                `${agentName}.md`,
                agentName
              ];
              for (const fName of fileCandidates) {
                const targetFile = path.resolve(candidateDir, fName);
                if (fs.existsSync(targetFile)) {
                  try {
                    const realTarget = fs.realpathSync(targetFile);
                    if (isStrictlyInside(canonicalBase, realTarget)) {
                      fs.rmSync(realTarget, { force: true });
                      if (!removedAgents.includes(agentName)) {
                        removedAgents.push(agentName);
                      }
                    }
                  } catch {
                    // Ignore removal failure
                  }
                }
              }
            }
          } catch {
            // Ignore dir realpath failure
          }
        }
      }
    }
  }

  return { removedMcp, removedSkills, removedPlugins, removedAgents };
}
