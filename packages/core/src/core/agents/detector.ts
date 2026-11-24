import fs from "node:fs";
import os from "node:os";
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

function isUnderHomeDir(p: string): boolean {
  if (!path.isAbsolute(p)) return false;
  const home = path.resolve(os.homedir());
  const abs = path.resolve(p);
  const underHome = abs === home || abs.startsWith(home + path.sep);
  if (!underHome) return false;
  // A custom absolute path inside the current project is project scoped.
  const cwd = path.resolve(process.cwd());
  return !(abs === cwd || abs.startsWith(cwd + path.sep));
}

export function isGlobalConfigPath(p: string): boolean {
  if (typeof p !== "string") return false;
  return (
    p.startsWith("~/") ||
    p.startsWith("~\\") ||
    p.includes("%APPDATA%") ||
    isUnderHomeDir(p) ||
    /^[a-zA-Z]:[/\\]Users[/\\]/i.test(p) ||
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

function findFirstExistingPath(
  paths: readonly string[] | undefined,
  kind: "file" | "directory"
): string | null {
  if (!paths || !Array.isArray(paths)) {
    return null;
  }
  for (const p of paths) {
    try {
      const expanded = expandHome(p);
      if (fs.existsSync(expanded)) {
        const stat = fs.statSync(expanded);
        if (kind === "file" ? stat.isFile() : stat.isDirectory()) {
          return expanded;
        }
      }
    } catch {
      // Ignore path access error
    }
  }
  return null;
}

export function detectAgents(profiles?: Record<string, AgentProfile>): DetectedAgent[] {
  const activeProfiles = profiles || getAgentProfiles();
  const detected: DetectedAgent[] = [];

  for (const [id, profile] of Object.entries(activeProfiles)) {
    if (isPrototypePollutionKey(id)) continue;
    if (!profile || typeof profile !== "object") continue;

    const resolvedMcpPath = findFirstExistingPath(profile.mcpConfig?.paths, "file");
    const resolvedSkillsPath = findFirstExistingPath(profile.skills?.paths, "directory");
    const resolvedAgentsDirPath = findFirstExistingPath(profile.agents?.paths, "directory");
    const resolvedPluginsConfigPath = findFirstExistingPath(profile.plugins?.paths, "file");
    const resolvedPluginsDirPath = findFirstExistingPath(profile.plugins?.dirPaths, "directory");

    if (
      resolvedMcpPath ||
      resolvedSkillsPath ||
      resolvedPluginsConfigPath ||
      resolvedPluginsDirPath ||
      resolvedAgentsDirPath
    ) {
      detected.push({
        id,
        name: profile.name,
        mcpConfigPath: resolvedMcpPath,
        skillsDirPath: resolvedSkillsPath,
        pluginsConfigPath: resolvedPluginsConfigPath,
        pluginsDirPath: resolvedPluginsDirPath,
        agentsDirPath: resolvedAgentsDirPath
      });
    }
  }

  return detected;
}
