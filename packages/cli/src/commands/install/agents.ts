import fs from "node:fs";
import path from "node:path";
import {
  expandHome,
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
        expandHome(`~/.cache/opencode/npm`)
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
              fs.symlinkSync(sourcePath, targetPkgDir, "junction");
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
          const isOpenCode =
            agentId === "opencode" ||
            agentId.includes("opencode") ||
            (profile.plugins.format === "array" && /opencode\.jsonc?$/i.test(primaryPluginsConfig));

          // Extract any local plugin files if present
          const destPluginDir =
            customPluginDir ||
            (profile.plugins.dirPaths ? resolveActiveAgentPath(profile.plugins.dirPaths) : undefined) ||
            (isOpenCode ? "./.opencode/plugins" : "./plugin");

          for (const pl of compatiblePlugins) {
            const files = extractPluginFiles(pl, rawFiles, localDir);
            if (Object.keys(files).length > 0) {
              const pName = typeof pl === "string" ? pl : pl.name;
              installPluginFiles(destPluginDir, pName, files);
              if (isOpenCode) {
                ensurePluginDependenciesResolvable(destPluginDir, files);
              }
            }
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
  }

  return { installedMcp, installedSkills, installedPlugins };
}
