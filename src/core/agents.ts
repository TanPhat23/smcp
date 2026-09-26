import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentProfile, DetectedAgent, McpServerConfig, SkillEntry } from "../types.ts";
import { hashContent } from "../utils/crypto.ts";
import { expandHome } from "../utils/paths.ts";

export type { DetectedAgent };

export const DEFAULT_AGENTS: Record<string, AgentProfile> = {
  opencode: {
    name: "OpenCode",
    mcpConfig: {
      paths: ["~/.config/opencode/opencode.json", "./opencode.json"],
      key: "mcpServers"
    },
    skills: {
      paths: ["~/.config/opencode/skills", "./.opencode/skills"]
    }
  },
  "claude-code": {
    name: "Claude Code",
    mcpConfig: {
      paths: ["~/.claude.json", "./.claude.json"],
      key: "mcpServers"
    },
    skills: {
      paths: ["~/.claude/skills", "./skills"]
    }
  },
  "claude-desktop": {
    name: "Claude Desktop",
    mcpConfig: {
      paths: [
        "~/.config/Claude/claude_desktop_config.json",
        "~/Library/Application Support/Claude/claude_desktop_config.json",
        "%APPDATA%/Claude/claude_desktop_config.json"
      ],
      key: "mcpServers"
    },
    skills: null
  },
  cursor: {
    name: "Cursor",
    mcpConfig: {
      paths: ["~/.cursor/mcp.json", "./.cursor/mcp.json"],
      key: "mcpServers"
    },
    skills: {
      paths: ["~/.cursor/skills", "./.cursor/rules"]
    }
  },
  windsurf: {
    name: "Windsurf",
    mcpConfig: {
      paths: ["~/.codeium/windsurf/mcp_config.json"],
      key: "mcpServers"
    },
    skills: {
      paths: ["~/.codeium/windsurf/skills"]
    }
  }
};

function getCustomAgentsPath(): string {
  if (process.env.SMCP_CUSTOM_AGENTS_PATH) {
    return process.env.SMCP_CUSTOM_AGENTS_PATH;
  }
  const smcpDir = process.env.SMCP_DIR || path.join(os.homedir(), ".smcp");
  return path.join(smcpDir, "custom-agents.json");
}

export function getAgentProfiles(customAgentsPath?: string): Record<string, AgentProfile> {
  const profiles: Record<string, AgentProfile> = structuredClone(DEFAULT_AGENTS);
  const filePath = customAgentsPath || getCustomAgentsPath();

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const custom = JSON.parse(raw);
      if (custom && typeof custom === "object" && !Array.isArray(custom)) {
        for (const [key, value] of Object.entries(custom)) {
          if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
          profiles[key] = value as AgentProfile;
        }
      }
    } catch {
      // Ignore corrupt custom config
    }
  }

  return profiles;
}

export function saveCustomAgent(id: string, profile: AgentProfile, customAgentsPath?: string): void {
  if (id === "__proto__" || id === "constructor" || id === "prototype") {
    throw new Error(`Invalid agent ID: ${id}`);
  }

  const filePath = customAgentsPath || getCustomAgentsPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  let current: Record<string, AgentProfile> = {};
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        current = parsed;
      }
    } catch {
      current = {};
    }
  }

  current[id] = profile;
  fs.writeFileSync(filePath, JSON.stringify(current, null, 2), "utf8");
}

export function detectAgents(profiles?: Record<string, AgentProfile>): DetectedAgent[] {
  const activeProfiles = profiles || getAgentProfiles();
  const detected: DetectedAgent[] = [];

  for (const [id, profile] of Object.entries(activeProfiles)) {
    if (id === "__proto__" || id === "constructor" || id === "prototype") continue;

    let resolvedMcpPath: string | null = null;
    let resolvedSkillsPath: string | null = null;

    if (profile.mcpConfig && Array.isArray(profile.mcpConfig.paths)) {
      for (const p of profile.mcpConfig.paths) {
        try {
          const expanded = expandHome(p);
          if (fs.existsSync(expanded)) {
            resolvedMcpPath = expanded;
            break;
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
            resolvedSkillsPath = expanded;
            break;
          }
        } catch {
          // Ignore path access error
        }
      }
    }

    if (resolvedMcpPath || resolvedSkillsPath) {
      detected.push({
        id,
        name: profile.name,
        mcpConfigPath: resolvedMcpPath,
        skillsDirPath: resolvedSkillsPath
      });
    }
  }

  return detected;
}

export function readInstalledMcpServers(
  mcpConfigPath: string,
  key = "mcpServers"
): Record<string, McpServerConfig> {
  if (!mcpConfigPath) return {};
  try {
    if (!fs.existsSync(mcpConfigPath)) return {};
    const stat = fs.statSync(mcpConfigPath);
    if (!stat.isFile()) return {};
    const raw = fs.readFileSync(mcpConfigPath, "utf8");
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return {};
    }
    const servers = json[key];
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      return {};
    }
    return servers as Record<string, McpServerConfig>;
  } catch {
    return {};
  }
}

export function scanSkills(skillsDirPath: string): SkillEntry[] {
  if (!skillsDirPath) return [];
  try {
    if (!fs.existsSync(skillsDirPath)) return [];
    const stat = fs.statSync(skillsDirPath);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  let items: fs.Dirent[] = [];
  try {
    items = fs.readdirSync(skillsDirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: SkillEntry[] = [];
  const sortedItems = items
    .filter((item) => !item.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const item of sortedItems) {
    const fullPath = path.join(skillsDirPath, item.name);
    if (item.isDirectory()) {
      let skillFile: string | null = null;
      for (const candidate of ["SKILL.md", "README.md"]) {
        const candPath = path.join(fullPath, candidate);
        if (fs.existsSync(candPath)) {
          try {
            if (fs.statSync(candPath).isFile()) {
              skillFile = candPath;
              break;
            }
          } catch {}
        }
      }

      let content = "";
      if (skillFile) {
        try {
          content = fs.readFileSync(skillFile, "utf8");
        } catch {
          content = "";
        }
      }

      entries.push({
        name: item.name,
        path: skillFile || fullPath,
        contentHash: content ? hashContent(content) : undefined,
        description: `Skill in ${item.name}`
      });
    } else if (item.isFile() && item.name.endsWith(".md")) {
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        entries.push({
          name: item.name.replace(/\.md$/, ""),
          path: fullPath,
          contentHash: hashContent(content),
          description: `Skill ${item.name}`
        });
      } catch {
        // Skip unreadable file
      }
    }
  }

  return entries;
}
