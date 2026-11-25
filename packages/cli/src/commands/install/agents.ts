import fs from "node:fs";
import path from "node:path";
import {
  detectAvailableRuntime,
  expandHome,
  getAgentProfiles,
  installAgentFiles,
  installPluginFiles,
  installRuleFile,
  installSkillFiles,
  isGlobalConfigPath,
  isRuleFilePath,
  mergeHooksIntoFile,
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
import {
  extractAgentContent,
  extractDirectoryPluginComponents,
  extractPluginFiles,
  extractRuleContent,
  extractSkillFiles
} from "./extract.ts";

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
  rulesDir?: string;
  rules?: string[];
  hooksConfig?: string;
  hooks?: string[];
}

function filterCompatiblePlugins(
  plugins: NonNullable<Manifest["plugins"]>,
  agentId: string,
  format?: "array" | "map" | "directory"
): NonNullable<Manifest["plugins"]> {
  return plugins.filter((pl) => {
    if (typeof pl === "string") return true;
    if (!pl.targetAgent) return true;
    if (pl.targetAgent === agentId) return true;
    if (
      pl.targetAgent === "opencode" &&
      (agentId === "opencode" || agentId.includes("opencode") || format === "array")
    ) {
      return true;
    }
    if (
      pl.targetAgent === "claude-code" &&
      (agentId === "claude-code" || agentId.startsWith("claude") || agentId.includes("claude") || format === "map")
    ) {
      return true;
    }
    if (
      (pl.targetAgent === "agy" || pl.targetAgent === "antigravity") &&
      (agentId === "agy" || format === "directory")
    ) {
      return true;
    }
    return false;
  });
}

function isScriptFilePluginName(name: string): boolean {
  return (
    name.endsWith(".ts") ||
    name.endsWith(".js") ||
    name.endsWith(".mjs") ||
    name.endsWith(".cjs") ||
    (name.includes(".ts") && (name.startsWith("./") || name.startsWith("../") || name.startsWith("/")))
  );
}

function hasDirectoryPluginManifest(files: Record<string, string>): boolean {
  return (
    Object.hasOwn(files, "plugin.json") ||
    Object.hasOwn(files, ".antigravity-plugin/plugin.json") ||
    Object.hasOwn(files, ".gemini-plugin/plugin.json") ||
    Object.hasOwn(files, "gemini-extension.json")
  );
}

function isDirectoryPluginBundle(
  pl: NonNullable<Manifest["plugins"]>[number],
  files: Record<string, string>
): boolean {
  if (Object.keys(files).length === 0) return false;
  if (typeof pl === "object" && (pl.targetAgent === "agy" || pl.targetAgent === "antigravity")) {
    return true;
  }
  return (
    hasDirectoryPluginManifest(files) ||
    Object.hasOwn(files, ".claude-plugin/plugin.json") ||
    Object.hasOwn(files, "mcp_config.json") ||
    Object.hasOwn(files, "mcp.json") ||
    Object.hasOwn(files, "hooks.json") ||
    Object.keys(files).some((k) => k.startsWith("skills/") || k.startsWith("agents/"))
  );
}

function installFallbackPluginComponentsForAgent(
  agentId: string,
  profile: AgentProfile,
  manifestPlugins: NonNullable<Manifest["plugins"]>,
  rawFiles: Record<string, string> | undefined,
  localDir: string | undefined,
  effectiveRuntime: string,
  scope: "global" | "project" | undefined,
  written: WrittenAgentPaths,
  installedAgentNames: string[]
): boolean {
  let installedAny = false;
  const extractedMcp: Record<string, McpServerConfig> = {};
  const extractedSkills: Record<string, Record<string, string>> = {};
  const extractedAgents: Array<{ name: string; content: string }> = [];

  for (const pl of manifestPlugins) {
    const pName = typeof pl === "string" ? pl : pl.name;
    if (isScriptFilePluginName(pName)) continue;
    const files = extractPluginFiles(pl, rawFiles, localDir);
    if (!isDirectoryPluginBundle(pl, files)) continue;

    const components = extractDirectoryPluginComponents(files);
    for (const [sName, sConf] of Object.entries(components.mcpServers)) {
      if (!extractedMcp[sName]) {
        extractedMcp[sName] = transformMcpServerRuntime(sConf, effectiveRuntime);
      }
    }
    for (const [skName, skFiles] of Object.entries(components.skills)) {
      if (!extractedSkills[skName]) {
        extractedSkills[skName] = skFiles;
      }
    }
    for (const ag of components.agents) {
      if (!extractedAgents.some((existing) => existing.name === ag.name)) {
        extractedAgents.push(ag);
      }
    }
  }

  if (profile.mcpConfig?.paths?.length && Object.keys(extractedMcp).length > 0) {
    const primaryMcpPath = resolveActiveAgentPath(profile.mcpConfig.paths, { scope });
    if (primaryMcpPath) {
      mergeMcpServersIntoFile(primaryMcpPath, extractedMcp, {
        mcpKey: profile.mcpConfig.key || "mcpServers",
        format: profile.mcpConfig.format,
        agentId
      });
      written.config = primaryMcpPath;
      installedAny = true;
    }
  }

  if (profile.skills?.paths?.length && Object.keys(extractedSkills).length > 0) {
    const primarySkillsDir = resolveActiveAgentPath(profile.skills.paths, { scope });
    if (primarySkillsDir) {
      written.skillsDir = primarySkillsDir;
      written.skills = written.skills || [];
      for (const [skName, skFiles] of Object.entries(extractedSkills)) {
        installSkillFiles(primarySkillsDir, skName, skFiles);
        if (!written.skills.includes(skName)) written.skills.push(skName);
      }
      installedAny = true;
    }
  }

  if (profile.agents?.paths?.length && extractedAgents.length > 0) {
    const primaryAgentsDir = resolveActiveAgentPath(profile.agents.paths, { scope });
    if (primaryAgentsDir) {
      written.agentsDir = primaryAgentsDir;
      written.agents = written.agents || [];
      for (const ag of extractedAgents) {
        try {
          const parsed = parseAgentMarkdown(ag.content, ag.name);
          const { writtenPath } = installAgentFiles(primaryAgentsDir, parsed, agentId);
          const installedName = path.basename(writtenPath, path.extname(writtenPath));
          if (!written.agents.includes(installedName)) written.agents.push(installedName);
          if (!installedAgentNames.includes(installedName)) installedAgentNames.push(installedName);
          installedAny = true;
        } catch {
          // Skip unparseable plugin agent
        }
      }
    }
  }

  return installedAny;
}

function installPluginsForAgent(
  agentId: string,
  profile: AgentProfile,
  manifestPlugins: NonNullable<Manifest["plugins"]>,
  rawFiles: Record<string, string> | undefined,
  localDir: string | undefined,
  customPluginDir: string | undefined,
  effectiveRuntime: string,
  scope: "global" | "project" | undefined,
  written: WrittenAgentPaths,
  installedAgentNames: string[]
): boolean {
  const pluginsConfig = profile.plugins;
  const format = pluginsConfig?.format || "array";
  const compatiblePlugins = pluginsConfig
    ? filterCompatiblePlugins(manifestPlugins, agentId, format)
    : [];

  if (!pluginsConfig) {
    return installFallbackPluginComponentsForAgent(
      agentId,
      profile,
      manifestPlugins,
      rawFiles,
      localDir,
      effectiveRuntime,
      scope,
      written,
      installedAgentNames
    );
  }

  if (format === "directory") {
    if (compatiblePlugins.length === 0) return false;
    const destPluginDir =
      customPluginDir ||
      (pluginsConfig.dirPaths ? resolveActiveAgentPath(pluginsConfig.dirPaths, { scope }) : undefined);
    if (!destPluginDir) return false;

    const installedPluginNames: string[] = [];
    for (const pl of compatiblePlugins) {
      const pName = typeof pl === "string" ? pl : pl.name;
      if (isScriptFilePluginName(pName)) continue;

      const files = extractPluginFiles(pl, rawFiles, localDir);
      if (Object.keys(files).length === 0) continue;

      const filesToInstall = hasDirectoryPluginManifest(files)
        ? files
        : {
            "plugin.json": JSON.stringify({ name: pName }, null, 2) + "\n",
            ...files
          };

      installPluginFiles(destPluginDir, pName, filesToInstall);
      installedPluginNames.push(pName);
    }

    if (installedPluginNames.length === 0) return false;
    written.pluginDir = destPluginDir;
    written.plugins = installedPluginNames;
    return true;
  }

  const fallbackInstalled = installFallbackPluginComponentsForAgent(
    agentId,
    profile,
    manifestPlugins,
    rawFiles,
    localDir,
    effectiveRuntime,
    scope,
    written,
    installedAgentNames
  );

  if (compatiblePlugins.length === 0 || !pluginsConfig.paths || pluginsConfig.paths.length === 0) {
    return fallbackInstalled;
  }
  const primaryPluginsConfig = resolveActiveAgentPath(pluginsConfig.paths, { scope });
  if (!primaryPluginsConfig) return fallbackInstalled;

  const isOpenCode =
    agentId === "opencode" ||
    agentId.includes("opencode") ||
    (format === "array" && /opencode\.jsonc?$/i.test(primaryPluginsConfig));

  const destPluginDir =
    customPluginDir ||
    (pluginsConfig.dirPaths ? resolveActiveAgentPath(pluginsConfig.dirPaths, { scope }) : undefined) ||
    (isOpenCode ? "./.opencode/plugins" : "./plugin");

  const installedPluginNames: string[] = [];
  for (const pl of compatiblePlugins) {
    const files = extractPluginFiles(pl, rawFiles, localDir);
    if (Object.keys(files).length > 0 && !isDirectoryPluginBundle(pl, files)) {
      const pName = typeof pl === "string" ? pl : pl.name;
      installPluginFiles(destPluginDir, pName, files);
      if (isOpenCode) {
        ensurePluginDependenciesResolvable(destPluginDir, files);
      }
      installedPluginNames.push(pName);
    }
  }

  if (installedPluginNames.length > 0) {
    written.pluginDir = destPluginDir;
    written.plugins = installedPluginNames;
  }

  const pluginsForConfig = isOpenCode
    ? compatiblePlugins.filter((pl) => {
        const name = typeof pl === "string" ? pl : pl.name;
        return !isScriptFilePluginName(name);
      })
    : compatiblePlugins.filter((pl) => !isDirectoryPluginBundle(pl, extractPluginFiles(pl, rawFiles, localDir)));

  if (pluginsForConfig.length > 0 || installedPluginNames.length > 0) {
    mergePluginsIntoFile(
      primaryPluginsConfig,
      pluginsForConfig,
      pluginsConfig.key || (isOpenCode ? "plugins" : "plugin"),
      format
    );
    return true;
  }

  return fallbackInstalled;
}

function getRuleFileStem(rawPath: string): string {
  const base = path.basename(rawPath);
  if (base.startsWith(".")) return base.slice(1);
  return path.basename(rawPath, path.extname(rawPath));
}

function resolveRuleInstallTarget(
  ruleName: string,
  profileRulePaths: readonly string[],
  scope: "global" | "project" | undefined
): string | undefined {
  if (profileRulePaths.length === 0) return undefined;

  const scopedPaths =
    scope === "global"
      ? profileRulePaths.filter((p) => isGlobalConfigPath(p))
      : scope === "project"
        ? profileRulePaths.filter((p) => !isGlobalConfigPath(p))
        : profileRulePaths;

  const candidates = scopedPaths.length > 0 ? scopedPaths : profileRulePaths;

  const explicitMatch = candidates.find((candidate) => {
    if (!isRuleFilePath(candidate)) return false;
    const stem = getRuleFileStem(candidate);
    if (isGlobalConfigPath(candidate)) {
      return ruleName === `global-${stem}` || (scope === "global" && ruleName === stem);
    }
    return ruleName === stem;
  });
  if (explicitMatch) {
    return expandHome(explicitMatch);
  }

  const ruleDirs = candidates.filter((candidate) => !isRuleFilePath(candidate));
  if (ruleDirs.length > 0) {
    const resolvedDir = resolveActiveAgentPath(ruleDirs, { scope });
    if (resolvedDir) return resolvedDir;
  }

  const activeFile = resolveActiveAgentPath([...candidates], { scope });
  if (!activeFile) return undefined;
  return isRuleFilePath(activeFile) ? path.join(path.dirname(activeFile), "rules") : activeFile;
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
  installedRules: string[];
  installedHooks: string[];
  writtenPaths: Record<string, WrittenAgentPaths>;
} {
  const activeProfiles = profiles || getAgentProfiles();
  const installedMcp: string[] = [];
  const installedSkills: string[] = [];
  const installedPlugins: string[] = [];
  const installedAgents: string[] = [];
  const installedRules: string[] = [];
  const installedHooks: string[] = [];
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
      profile.mcpConfig?.paths?.length &&
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
      profile.skills?.paths?.length &&
      manifest.skills?.length
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

    // Install Plugins (or flatten directory-plugin MCP/skills/agents for non-directory harnesses)
    if (manifest.plugins?.length) {
      if (
        installPluginsForAgent(
          agentId,
          profile,
          manifest.plugins,
          rawFiles,
          localDir,
          customPluginDir,
          effectiveRuntime,
          scope,
          writtenPaths[agentId],
          installedAgents
        )
      ) {
        installedPlugins.push(agentId);
      }
    }

    // Install Agents
    if (
      profile.agents?.paths?.length &&
      manifest.agents?.length
    ) {
      const primaryAgentsDir = resolveActiveAgentPath(profile.agents.paths, { scope });
      if (primaryAgentsDir) {
        const installedAgentNames: string[] = [...(writtenPaths[agentId].agents || [])];
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
            const { writtenPath } = installAgentFiles(primaryAgentsDir, agentObj, agentId);
            const installedName = path.basename(writtenPath, path.extname(writtenPath));
            if (!installedAgentNames.includes(installedName)) {
              installedAgentNames.push(installedName);
            }
            if (!installedAgents.includes(installedName)) {
              installedAgents.push(installedName);
            }
          } catch {
            // Ignore installation error for unsupported harnesses
          }
        }

        if (installedAgentNames.length > 0) {
          writtenPaths[agentId] = writtenPaths[agentId] || { scope: agentScope };
          writtenPaths[agentId].agentsDir = primaryAgentsDir;
          writtenPaths[agentId].agents = installedAgentNames;
        }
      }
    }

    // Install Rules
    if (profile.rules?.paths?.length && manifest.rules?.length) {
      const installedAgentRules: string[] = [];

      for (const rule of manifest.rules) {
        const content = extractRuleContent(rule, rawFiles, localDir);
        if (!content) continue;
        const targetDest = resolveRuleInstallTarget(rule.name, profile.rules.paths, scope);
        if (!targetDest) continue;

        try {
          const writtenRulePath = installRuleFile(targetDest, rule.name, content);
          installedAgentRules.push(rule.name);
          if (!installedRules.includes(rule.name)) installedRules.push(rule.name);
          if (!writtenPaths[agentId].rulesDir) {
            writtenPaths[agentId].rulesDir = path.dirname(writtenRulePath);
          }
        } catch {
          // Ignore invalid rule entry
        }
      }
      if (installedAgentRules.length > 0) {
        writtenPaths[agentId].rules = installedAgentRules;
      }
    }

    // Install Lifecycle Hooks
    if (profile.hooks?.paths?.length && manifest.hooks && Object.keys(manifest.hooks).length > 0) {
      const hooksPath = resolveActiveAgentPath(profile.hooks.paths, { scope });
      if (hooksPath) {
        const mergedHooks = mergeHooksIntoFile(hooksPath, manifest.hooks, profile.hooks.key);
        if (mergedHooks.length > 0) {
          writtenPaths[agentId].hooksConfig = hooksPath;
          writtenPaths[agentId].hooks = mergedHooks;
          for (const hName of mergedHooks) {
            if (!installedHooks.includes(hName)) installedHooks.push(hName);
          }
        }
      }
    }
  }

  return {
    installedMcp,
    installedSkills,
    installedPlugins,
    installedAgents,
    installedRules,
    installedHooks,
    writtenPaths
  };
}
