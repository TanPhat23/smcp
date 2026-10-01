import fs from "node:fs";
import path from "node:path";
import {
  parseAgentMarkdown,
  scanSkills,
  type AgentEntry,
  type Manifest,
  type PluginEntry,
  type SkillEntry,
  type UniversalAgent,
  isStrictlyInside
} from "@tanphat/smcp-core";

export interface DiscoveredAgent extends UniversalAgent {
  path: string;
  rawContent: string;
}

export interface DiscoveredPackComponents {
  manifest?: Manifest;
  skills?: SkillEntry[];
  plugins?: PluginEntry[];
  agents?: DiscoveredAgent[];
}

/**
 * Discovers components (agents, skills, plugins, and manifest) in a pack workspace directory.
 *
 * @param baseDir The root directory of the pack workspace.
 * @returns Discovered pack components.
 */
export function discoverPackComponents(baseDir: string): DiscoveredPackComponents {
  if (!baseDir || typeof baseDir !== "string") {
    return {};
  }

  const root = path.resolve(baseDir);
  if (!fs.existsSync(root)) {
    return {};
  }

  const result: DiscoveredPackComponents = {};

  // 1. Discover smcp.json if present
  const manifestPath = path.join(root, "smcp.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const content = fs.readFileSync(manifestPath, "utf8");
      result.manifest = JSON.parse(content);
    } catch {
      // Unparseable manifest will be ignored during discovery
    }
  }

  // 2. Discover skills/ if present
  const skillsDir = path.join(root, "skills");
  if (fs.existsSync(skillsDir)) {
    try {
      const stat = fs.statSync(skillsDir);
      if (stat.isDirectory()) {
        const skills = scanSkills(skillsDir);
        if (skills.length > 0) {
          result.skills = skills;
        }
      }
    } catch {
      // Ignore errors reading skills directory
    }
  }

  // 3. Discover plugins/ if present
  const pluginsDir = path.join(root, "plugins");
  if (fs.existsSync(pluginsDir)) {
    try {
      const stat = fs.statSync(pluginsDir);
      if (stat.isDirectory()) {
        const pluginEntries = fs.readdirSync(pluginsDir, { withFileTypes: true });
        const plugins: PluginEntry[] = [];
        for (const item of pluginEntries) {
          if (item.name.startsWith(".")) continue;
          plugins.push({
            name: item.name,
            path: path.posix.join("plugins", item.name)
          });
        }
        if (plugins.length > 0) {
          result.plugins = plugins;
        }
      }
    } catch {
      // Ignore errors reading plugins directory
    }
  }

  // 4. Discover agents/ if present
  const agentsDir = path.join(root, "agents");
  if (fs.existsSync(agentsDir)) {
    try {
      const stat = fs.statSync(agentsDir);
      if (stat.isDirectory()) {
        const canonicalAgentsDir = fs.realpathSync(agentsDir);
        const entries = fs.readdirSync(agentsDir).sort();
        const discoveredAgents: DiscoveredAgent[] = [];

        for (const entry of entries) {
          if (entry.startsWith(".")) continue;
          if (!entry.toLowerCase().endsWith(".md")) continue;

          const fullPath = path.join(agentsDir, entry);
          let fileStat: fs.Stats;
          try {
            fileStat = fs.statSync(fullPath);
          } catch {
            continue;
          }

          if (!fileStat.isFile()) continue;

          // Prevent symlink traversal outside agents directory
          const lstat = fs.lstatSync(fullPath);
          if (lstat.isSymbolicLink()) {
            try {
              const realFullPath = fs.realpathSync(fullPath);
              if (!isStrictlyInside(canonicalAgentsDir, realFullPath)) {
                continue;
              }
            } catch {
              continue;
            }
          }

          const rawContent = fs.readFileSync(fullPath, "utf8");
          const parsed = parseAgentMarkdown(rawContent, entry);
          discoveredAgents.push({
            ...parsed,
            path: path.posix.join("agents", entry),
            rawContent
          });
        }

        result.agents = discoveredAgents;
      }
    } catch (err: unknown) {
      // If parsing a file threw an error, propagate it with context
      if (err instanceof Error && err.message.includes("frontmatter")) {
        throw err;
      }
    }
  }

  return result;
}
