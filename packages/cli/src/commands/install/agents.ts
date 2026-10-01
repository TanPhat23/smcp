import fs from "node:fs";
import path from "node:path";
import {
  detectAvailableRuntime,
  expandHome,
  getAgentProfiles,
  installAgentFiles,
  installPluginFiles,
  installSkillFiles,
  isGlobalConfigPath,
  mergeMcpServersIntoFile,
  mergePluginsIntoFile,
  parseAgentMarkdown,
  resolveActiveAgentPath,
  transformMcpServerRuntime,
  type AgentProfile,
  type Manifest,
  type McpServerConfig,
  type UniversalAgent
} from "@tanphat/smcp-core";
import { extractAgentContent, extractPluginFiles, extractSkillFiles } from "./extract.ts";

export { resolveActiveAgentPath };
export const resolveActivePath = resolveActiveAgentPath;

export function ensurePluginDependenciesResolvable(
  destPluginDir: string,
  files: Record<string, string>
): void {
  const safeDest = path.resolve(expandHome(destPluginDir));
  const importedPackages = new Set<string>();

  for (const content of Object.values(files)) {
    if (typeof content !== "string") continue;
    const matches = content.matchAll(/(?:import|from)\s+["'](@?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)(?:["']|\/)/g);
    for (const match of matches) {
      const pkg = match[1];
      if (
        pkg &&
        !pkg.startsWith(".") &&
        !pkg.startsWith("/") &&
        !pkg.startsWith("node:") &&
        pkg !== "fs" &&
        pkg !== "path" &&
        pkg !== "os" &&
        pkg !== "child_process" &&
        pkg !== "events" &&
        pkg !== "crypto" &&
        pkg !== "stream" &&
        pkg !== "util" &&
        pkg !== "http" &&
        pkg !== "https" &&
        pkg !== "url" &&
        pkg !== "buffer"
      ) {
        const pkgName = pkg.startsWith("@") ? pkg.split("/").slice(0, 2).join("/") : pkg.split("/")[0];
        importedPackages.add(pkgName);
      }
    }
  }

  for (const pkg of importedPackages) {
    let curr = safeDest;
    let found = false;
    while (curr && curr !== path.dirname(curr)) {
      const candidate = path.join(curr, "node_modules", pkg);
      if (fs.existsSync(candidate)) {
        found = true;
        break;
      }
      curr = path.dirname(curr);
    }

    if (!found) {
      const candidateSources = [
        expandHome(`~/.config/opencode/node_modules/${pkg}`),
        expandHome(`~/.local/share/opencode/node_modules/${pkg}`),
        expandHome(`~/.cache/opencode/npm`),
        ...(process.env.APPDATA ? [path.join(process.env.APPDATA, "opencode", "node_modules", pkg)] : []),
        ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "opencode", "node_modules", pkg)] : [])
      ];

      let sourcePath: string | null = null;
      for (const cand of candidateSources) {
        if (fs.existsSync(cand)) {
          if (cand.endsWith(pkg)) {
            sourcePath = cand;
            break;
          } else {
            try {
              const entries = fs.readdirSync(cand, { recursive: true });
              for (const entry of entries) {
                const sub = path.join(cand, entry as string);
                if (sub.endsWith(path.join("node_modules", pkg)) && fs.existsSync(sub)) {
                  sourcePath = sub;
                  break;
                }
              }
            } catch {
              // ignore
            }
          }
        }
        if (sourcePath) break;
      }

      if (!sourcePath) {
        let walk = path.dirname(safeDest);
        while (walk && walk !== path.dirname(walk)) {
          try {
            const list = fs.readdirSync(walk);
            for (const item of list) {
              const testNodeModules = path.join(walk, item, "node_modules", pkg);
              if (fs.existsSync(testNodeModules)) {
                sourcePath = testNodeModules;
                break;
              }
            }
          } catch {}
          if (sourcePath) break;
          walk = path.dirname(walk);
        }
      }

      if (sourcePath && fs.existsSync(sourcePath)) {
        const targetNodeModules = path.join(safeDest, "..", "node_modules");
        const targetPkgDir = path.join(targetNodeModules, pkg);
        try {
          fs.mkdirSync(path.dirname(targetPkgDir), { recursive: true });
          if (!fs.existsSync(targetPkgDir)) {
            try {
              const symlinkType = process.platform === "win32" ? "junction" : "dir";
              fs.symlinkSync(sourcePath, targetPkgDir, symlinkType);
            } catch {
              fs.cpSync(sourcePath, targetPkgDir, { recursive: true });
            }
          }
        } catch {
          // ignore linking error
        }
      }
    }
  }
}

export interface WrittenAgentPaths {
  config?: string;
  scope?: "global" | "project";
  skillsDir?: string;
  skills?: string[];
  pluginDir?: string;
  plugins?: string[];
  agentsDir?: string;
  agents?: string[];
}

export function installPackIntoAgents(
  manifest: Manifest,
  targetAgentIds: string[],
  resolvedServers: Record<string, McpServerConfig>,
  rawFiles?: Record<string, string>,
  localDir?: string,
  profiles?: Record<string, AgentProfile>,
  customPluginDir?: string,
  runtime?: string,
  scope?: "global" | "project"
): {
  installedMcp: string[];
  installedSkills: string[];
  installedPlugins: string[];
  installedAgents: string[];
  writtenPaths: Record<string, WrittenAgentPaths>;
} {
  const activeProfiles = profiles || getAgentProfiles();
  const installedMcp: string[] = [];
  const installedSkills: string[] = [];
  const installedPlugins: string[] = [];
  const installedAgents: string[] = [];
  const writtenPaths: Record<string, WrittenAgentPaths> = {};

  const effectiveRuntime = runtime || detectAvailableRuntime();
  const transformedServers: Record<string, McpServerConfig> = {};
  for (const [sName, sConf] of Object.entries(resolvedServers)) {
    transformedServers[sName] = transformMcpServerRuntime(sConf, effectiveRuntime);
  }

  for (const agentId of targetAgentIds) {
    const profile = activeProfiles[agentId];
    if (!profile) continue;

    // Install MCP servers
    let agentScope: "global" | "project" = scope || "global";
    if (
      profile.mcpConfig &&
      profile.mcpConfig.paths &&
      profile.mcpConfig.paths.length > 0 &&
      Object.keys(transformedServers).length > 0
    ) {
      const primaryPath = resolveActiveAgentPath(profile.mcpConfig.paths, { scope });
      if (primaryPath) {
        agentScope = isGlobalConfigPath(primaryPath) ? "global" : "project";
        mergeMcpServersIntoFile(primaryPath, transformedServers, {
          mcpKey: profile.mcpConfig.key || "mcpServers",
          format: profile.mcpConfig.format,
          agentId
        });
        installedMcp.push(agentId);
        writtenPaths[agentId] = { scope: agentScope, config: primaryPath };
      }
    } else {
      writtenPaths[agentId] = { scope: agentScope };
    }

    // Install Skills
    if (
      profile.skills &&
      profile.skills.paths &&
      profile.skills.paths.length > 0 &&
      manifest.skills &&
      manifest.skills.length > 0
    ) {
      const primarySkillsDir = resolveActiveAgentPath(profile.skills.paths, { scope });
      if (primarySkillsDir) {
        const installedSkillNames: string[] = [];
        for (const skill of manifest.skills) {
          const filesToInstall = extractSkillFiles(skill, rawFiles, localDir);
          installSkillFiles(primarySkillsDir, skill.name, filesToInstall);
          installedSkillNames.push(skill.name);
        }
        installedSkills.push(agentId);
        writtenPaths[agentId].skillsDir = primarySkillsDir;
        writtenPaths[agentId].skills = installedSkillNames;
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
      const primaryPluginsConfig = resolveActiveAgentPath(profile.plugins.paths, { scope });
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
          const isOpenCode =
            agentId === "opencode" ||
            agentId.includes("opencode") ||
            (profile.plugins.format === "array" && /opencode\.jsonc?$/i.test(primaryPluginsConfig));

          // Extract any local plugin files if present
          const destPluginDir =
            customPluginDir ||
            (profile.plugins.dirPaths ? resolveActiveAgentPath(profile.plugins.dirPaths, { scope }) : undefined) ||
            (isOpenCode ? "./.opencode/plugins" : "./plugin");

          const installedPluginNames: string[] = [];
          for (const pl of compatiblePlugins) {
            const files = extractPluginFiles(pl, rawFiles, localDir);
            if (Object.keys(files).length > 0) {
              const pName = typeof pl === "string" ? pl : pl.name;
              installPluginFiles(destPluginDir, pName, files);
              if (isOpenCode) {
                ensurePluginDependenciesResolvable(destPluginDir, files);
              }
              installedPluginNames.push(pName);
            }
          }

          if (installedPluginNames.length > 0) {
            writtenPaths[agentId].pluginDir = destPluginDir;
            writtenPaths[agentId].plugins = installedPluginNames;
          }

          // For OpenCode: v2.0.20 rejects .ts file paths in plugins array ("configured plugin path must be a directory")
          // and auto-discovers from .opencode/plugins/*.ts.
          // Only pass package specifiers (npm packages) to mergePluginsIntoFile.
          const pluginsForConfig = isOpenCode
            ? compatiblePlugins.filter((pl) => {
                const name = typeof pl === "string" ? pl : pl.name;
                const isFilePath =
                  name.endsWith(".ts") ||
                  name.endsWith(".js") ||
                  name.endsWith(".mjs") ||
                  name.endsWith(".cjs") ||
                  (name.includes(".ts") && (name.startsWith("./") || name.startsWith("../") || name.startsWith("/")));
                return !isFilePath;
              })
            : compatiblePlugins;

          mergePluginsIntoFile(
            primaryPluginsConfig,
            pluginsForConfig,
            profile.plugins.key || (isOpenCode ? "plugins" : "plugin"),
            profile.plugins.format || "array"
          );

          installedPlugins.push(agentId);
        }
      }
    }

    // Install Agents
    if (
      profile.agents &&
      profile.agents.paths &&
      profile.agents.paths.length > 0 &&
      manifest.agents &&
      manifest.agents.length > 0
    ) {
      const primaryAgentsDir = resolveActiveAgentPath(profile.agents.paths, { scope });
      if (primaryAgentsDir) {
        const installedAgentNames: string[] = [];
        for (const agent of manifest.agents) {
          const content = extractAgentContent(agent, rawFiles, localDir);
          let agentObj: UniversalAgent;
          try {
            agentObj = parseAgentMarkdown(content, agent.path || agent.name);
          } catch {
            agentObj = {
              name: agent.name,
              description: agent.description || agent.name,
              mode: agent.mode || "subagent",
              model: agent.model,
              skills: [],
              prompt: content
            };
          }

          if (!agentObj.description && agent.description) {
            agentObj.description = agent.description;
          }

          try {
            installAgentFiles(primaryAgentsDir, agentObj, agentId);
            installedAgentNames.push(agent.name);
          } catch {
            // Ignore installation error for unsupported harnesses
          }
        }

        if (installedAgentNames.length > 0) {
          installedAgents.push(agentId);
          writtenPaths[agentId] = writtenPaths[agentId] || { scope: agentScope };
          writtenPaths[agentId].agentsDir = primaryAgentsDir;
          writtenPaths[agentId].agents = installedAgentNames;
        }
      }
    }
  }

  return { installedMcp, installedSkills, installedPlugins, installedAgents, writtenPaths };
}
