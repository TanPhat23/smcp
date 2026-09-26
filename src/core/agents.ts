import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentProfileSchema,
  type AgentProfile,
  type DetectedAgent,
  type McpServerConfig,
  type SkillEntry
} from "../types.ts";
import { hashContent } from "../utils/crypto.ts";
import { expandHome } from "../utils/paths.ts";

export type { DetectedAgent };

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

export const DEFAULT_AGENTS: Record<string, AgentProfile> = deepFreeze({
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
});

function getCustomAgentsPath(): string {
  if (process.env.SMCP_CUSTOM_AGENTS_PATH) {
    return expandHome(process.env.SMCP_CUSTOM_AGENTS_PATH);
  }
  const smcpDir = process.env.SMCP_DIR
    ? expandHome(process.env.SMCP_DIR)
    : path.join(os.homedir(), ".smcp");
  return path.join(smcpDir, "custom-agents.json");
}

export function getAgentProfiles(customAgentsPath?: string): Record<string, AgentProfile> {
  const profiles: Record<string, AgentProfile> = structuredClone(DEFAULT_AGENTS);
  const filePath = customAgentsPath ? expandHome(customAgentsPath) : getCustomAgentsPath();

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const custom = JSON.parse(raw);
      if (custom && typeof custom === "object" && !Array.isArray(custom)) {
        for (const [key, value] of Object.entries(custom)) {
          if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
          const parsed = AgentProfileSchema.safeParse(value);
          if (parsed.success) {
            profiles[key] = parsed.data;
          }
        }
      }
    } catch {
      // Ignore corrupt custom config
    }
  }

  return profiles;
}

export function saveCustomAgent(id: string, profile: AgentProfile, customAgentsPath?: string): void {
  if (typeof id !== "string") {
    throw new Error("Invalid agent ID: must be a string");
  }
  const trimmedId = id.trim();
  if (
    !trimmedId ||
    trimmedId === "__proto__" ||
    trimmedId === "constructor" ||
    trimmedId === "prototype" ||
    !/^[a-zA-Z0-9_-]+$/.test(trimmedId)
  ) {
    throw new Error(`Invalid agent ID: ${id}`);
  }

  const validatedProfile = AgentProfileSchema.parse(profile);

  const filePath = customAgentsPath ? expandHome(customAgentsPath) : getCustomAgentsPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  let current: Record<string, AgentProfile> = {};
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
          const parsedProfile = AgentProfileSchema.safeParse(v);
          if (parsedProfile.success) {
            current[k] = parsedProfile.data;
          }
        }
      }
    } catch {
      current = {};
    }
  }

  current[trimmedId] = validatedProfile;
  fs.writeFileSync(filePath, JSON.stringify(current, null, 2), "utf8");
}

export function detectAgents(profiles?: Record<string, AgentProfile>): DetectedAgent[] {
  const activeProfiles = profiles || getAgentProfiles();
  const detected: DetectedAgent[] = [];

  for (const [id, profile] of Object.entries(activeProfiles)) {
    if (id === "__proto__" || id === "constructor" || id === "prototype") continue;
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
    const resolvedPath = expandHome(mcpConfigPath);
    if (!fs.existsSync(resolvedPath)) return {};
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) return {};
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return {};
    }
    if (key === "__proto__" || key === "constructor" || key === "prototype" || !Object.hasOwn(json, key)) {
      return {};
    }
    const servers = (json as Record<string, unknown>)[key];
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      return {};
    }
    const result: Record<string, McpServerConfig> = {};
    for (const [serverName, serverConfig] of Object.entries(servers)) {
      if (
        serverName === "__proto__" ||
        serverName === "constructor" ||
        serverName === "prototype"
      ) {
        continue;
      }
      result[serverName] = serverConfig as McpServerConfig;
    }
    return result;
  } catch {
    return {};
  }
}

export function scanSkills(skillsDirPath: string): SkillEntry[] {
  if (!skillsDirPath) return [];
  const resolvedSkillsDir = expandHome(skillsDirPath);
  try {
    if (!fs.existsSync(resolvedSkillsDir)) return [];
    const stat = fs.statSync(resolvedSkillsDir);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  let items: fs.Dirent[] = [];
  try {
    items = fs.readdirSync(resolvedSkillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: SkillEntry[] = [];
  const sortedItems = items
    .filter((item) => !item.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const item of sortedItems) {
    const fullPath = path.join(resolvedSkillsDir, item.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      // Broken symlink or unreadable - skip
      continue;
    }

    if (stat.isDirectory()) {
      let skillFile: string | null = null;
      const candidates = ["SKILL.md", "skill.md", "README.md", "readme.md"];
      for (const candidate of candidates) {
        const candPath = path.join(fullPath, candidate);
        try {
          const candStat = fs.statSync(candPath);
          if (candStat.isFile()) {
            skillFile = candPath;
            break;
          }
        } catch {
          // File does not exist or unreadable
        }
      }

      if (!skillFile) {
        try {
          const subEntries = fs.readdirSync(fullPath);
          for (const candidate of ["skill.md", "readme.md"]) {
            const match = subEntries.find((e) => e.toLowerCase() === candidate);
            if (match) {
              const candPath = path.join(fullPath, match);
              const candStat = fs.statSync(candPath);
              if (candStat.isFile()) {
                skillFile = candPath;
                break;
              }
            }
          }
        } catch {
          // Directory unreadable
        }
      }

      if (!skillFile) {
        // If a directory does NOT contain any valid skill file, do NOT push it
        continue;
      }

      let content = "";
      try {
        content = fs.readFileSync(skillFile, "utf8");
      } catch {
        content = "";
      }

      entries.push({
        name: item.name,
        path: skillFile,
        contentHash: content ? hashContent(content) : undefined,
        description: `Skill in ${item.name}`
      });
    } else if (stat.isFile() && item.name.toLowerCase().endsWith(".md")) {
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        entries.push({
          name: item.name.replace(/\.md$/i, ""),
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
