import fs from "node:fs";
import path from "node:path";
import { type AgentProfile, type DetectedAgent } from "../../types/index.ts";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { getAgentProfiles } from "./profiles.ts";

export interface ResolveActivePathOptions {
  scope?: "global" | "project";
  homeDir?: string;
  cwd?: string;
}

export function isGlobalConfigPath(p: string): boolean {
  if (typeof p !== "string") return false;
  return (
    p.startsWith("~/") ||
    p.startsWith("~\\") ||
    p.includes("%APPDATA%") ||
    p.startsWith("/home") ||
    /^[a-zA-Z]:[/\\]Users[/\\]/i.test(p) ||
    p.includes(".config") ||
    p.includes("AppData") ||
    p.includes("Library/Application Support")
  );
}

export function resolveActiveAgentPath(
  paths?: string[],
  options?: ResolveActivePathOptions
): string | null {
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return null;
  }

  const scope = options?.scope;
  const customHome = options?.homeDir;
  const cwd = options?.cwd || process.cwd();

  const isGlobal = (p: string) => isGlobalConfigPath(p);

  // 1. Explicit global scope requested
  if (scope === "global") {
    const globalCandidates = paths.filter(isGlobal);
    const candidateList = globalCandidates.length > 0 ? globalCandidates : paths;
    for (const p of candidateList) {
      const exp = expandHome(p, customHome);
      if (fs.existsSync(exp)) return exp;
    }
    return expandHome(candidateList[0], customHome);
  }

  // 2. Explicit project scope requested
  if (scope === "project") {
    const projectCandidates = paths.filter((p) => !isGlobal(p));
    const candidateList = projectCandidates.length > 0 ? projectCandidates : paths;
    for (const p of candidateList) {
      const exp = path.isAbsolute(p) ? p : path.resolve(cwd, p);
      if (fs.existsSync(exp)) return exp;
    }
    const first = candidateList[0];
    return path.isAbsolute(first) ? first : path.resolve(cwd, first);
  }

  // 3. Default (no explicit scope):
  // Check if a project-local path already exists in cwd
  for (const p of paths) {
    if (!isGlobal(p)) {
      const exp = path.isAbsolute(p) ? p : path.resolve(cwd, p);
      if (fs.existsSync(exp)) return exp;
    }
  }

  // Check if a global path already exists
  for (const p of paths) {
    if (isGlobal(p)) {
      const exp = expandHome(p, customHome);
      if (fs.existsSync(exp)) return exp;
    }
  }

  // Check if any other configured path already exists
  for (const p of paths) {
    const exp = isGlobal(p)
      ? expandHome(p, customHome)
      : (path.isAbsolute(p) ? p : path.resolve(cwd, p));
    if (fs.existsSync(exp)) return exp;
  }

  // Nothing exists on disk yet. Default to GLOBAL if defined, preventing accidental cwd clutter
  const defaultGlobal = paths.find(isGlobal);
  if (defaultGlobal) {
    return expandHome(defaultGlobal, customHome);
  }

  const first = paths[0];
  return isGlobal(first)
    ? expandHome(first, customHome)
    : (path.isAbsolute(first) ? first : path.resolve(cwd, first));
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

    if (
      resolvedMcpPath ||
      resolvedSkillsPath ||
      resolvedPluginsConfigPath ||
      resolvedPluginsDirPath
    ) {
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
