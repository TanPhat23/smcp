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

function collectCandidatePaths(paths: readonly string[]): string[] {
  const candidates = new Set<string>();
  for (const scope of ["global", "project"] as const) {
    const resolved = resolveActiveAgentPath([...paths], { scope });
    if (resolved) candidates.add(resolved);
  }
  for (const p of paths) {
    candidates.add(isGlobalConfigPath(p) ? expandHome(p) : path.resolve(p));
  }
  return Array.from(candidates);
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === "object" && !Array.isArray(val));
}

function removeSafelyInside(
  baseDir: string,
  entryName: string,
  recursive: boolean
): boolean {
  if (!fs.existsSync(baseDir)) return false;
  try {
    const canonicalBase = fs.realpathSync(baseDir);
    const targetPath = path.resolve(baseDir, entryName);
    if (!fs.existsSync(targetPath)) return false;
    const realTarget = fs.realpathSync(targetPath);
    if (!isStrictlyInside(canonicalBase, realTarget)) return false;
    fs.rmSync(realTarget, { recursive, force: true });
    return true;
  } catch {
    return false;
  }
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
      profile.mcpConfig?.paths?.length &&
      record.installedMcp?.length
    ) {
      const targetKey = profile.mcpConfig.key || "mcpServers";

      for (const activePath of collectCandidatePaths(profile.mcpConfig.paths)) {
        if (!fs.existsSync(activePath)) continue;
        try {
          const writePath = fs.realpathSync(activePath);
          const raw = fs.readFileSync(writePath, "utf8");
          const config: unknown = JSON.parse(stripJsonComments(raw));
          if (!isPlainRecord(config)) continue;

          let modified = false;
          const removeFrom = (map: unknown) => {
            if (!isPlainRecord(map)) return;
            for (const sName of record.installedMcp) {
              if (isPrototypePollutionKey(sName)) continue;
              if (Object.hasOwn(map, sName)) {
                delete map[sName];
                modified = true;
                if (!removedMcp.includes(sName)) removedMcp.push(sName);
              }
            }
          };

          // OpenCode V2 format (mcp.servers)
          if (isPlainRecord(config.mcp)) {
            removeFrom(config.mcp.servers);
          }
          // Standard format (mcpServers or profile.mcpConfig.key)
          removeFrom(config[targetKey]);
          // Claude Code per-project servers inside ~/.claude.json
          if (isPlainRecord(config.projects)) {
            for (const dir of new Set([process.cwd(), os.homedir()])) {
              if (Object.hasOwn(config.projects, dir)) {
                const projEntry = config.projects[dir];
                if (isPlainRecord(projEntry)) {
                  removeFrom(projEntry.mcpServers);
                }
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
      profile.skills?.paths?.length &&
      record.installedSkills?.length
    ) {
      for (const candidateSkillsDir of collectCandidatePaths(profile.skills.paths)) {
        for (const skillName of record.installedSkills) {
          if (!skillName || isPrototypePollutionKey(skillName)) continue;
          if (removeSafelyInside(candidateSkillsDir, skillName, true)) {
            if (!removedSkills.includes(skillName)) removedSkills.push(skillName);
          }
        }
      }
    }

    // 3a. Remove enabled-plugin map entries (e.g. Claude Code enabledPlugins)
    if (
      profile.plugins &&
      profile.plugins.format === "map" &&
      profile.plugins.paths?.length &&
      record.installedPlugins?.length
    ) {
      const mapKey = profile.plugins.key || "enabledPlugins";
      for (const p of profile.plugins.paths) {
        const file = isGlobalConfigPath(p) ? expandHome(p) : path.resolve(p);
        if (!fs.existsSync(file)) continue;
        try {
          const writePath = fs.realpathSync(file);
          const config: unknown = JSON.parse(stripJsonComments(fs.readFileSync(writePath, "utf8")));
          if (!isPlainRecord(config)) continue;
          const map = config[mapKey];
          if (!isPlainRecord(map)) continue;
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

    // 3b. Remove plugin files or directories
    if (
      profile.plugins?.dirPaths?.length &&
      record.installedPlugins?.length
    ) {
      for (const candidatePluginsDir of collectCandidatePaths(profile.plugins.dirPaths)) {
        for (const pluginName of record.installedPlugins) {
          if (!pluginName || isPrototypePollutionKey(pluginName)) continue;
          if (removeSafelyInside(candidatePluginsDir, pluginName, true)) {
            if (!removedPlugins.includes(pluginName)) removedPlugins.push(pluginName);
          }
        }
      }
    }

    // 4. Remove agent files
    if (
      profile.agents?.paths?.length &&
      record.installedAgents?.length
    ) {
      for (const candidateDir of collectCandidatePaths(profile.agents.paths)) {
        for (const agentName of record.installedAgents) {
          if (!agentName || isPrototypePollutionKey(agentName)) continue;
          for (const fName of [`${agentName}.md`, agentName]) {
            if (removeSafelyInside(candidateDir, fName, false)) {
              if (!removedAgents.includes(agentName)) {
                removedAgents.push(agentName);
              }
            }
          }
        }
      }
    }
  }

  return { removedMcp, removedSkills, removedPlugins, removedAgents };
}
