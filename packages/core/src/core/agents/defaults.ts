import type { AgentProfile } from "../../types/index.ts";

export function deepFreeze<T>(obj: T): T {
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
      paths: [
        "./opencode.jsonc",
        "./opencode.json",
        ".opencode/opencode.jsonc",
        ".opencode/opencode.json",
        "~/.config/opencode/opencode.jsonc",
        "~/.config/opencode/opencode.json"
      ],
      key: "mcp",
      format: "opencode"
    },
    skills: {
      paths: [
        "./.opencode/skills",
        "~/.agents/skills",
        "~/.config/opencode/skills"
      ]
    },
    plugins: {
      paths: [
        "./opencode.jsonc",
        "./opencode.json",
        ".opencode/opencode.jsonc",
        ".opencode/opencode.json",
        "~/.config/opencode/opencode.jsonc",
        "~/.config/opencode/opencode.json"
      ],
      key: "plugins",
      format: "array",
      dirPaths: [
        "./.opencode/plugins",
        "~/.config/opencode/plugins"
      ]
    },
    agents: {
      paths: [
        "~/.config/opencode/agents",
        "./.opencode/agents"
      ],
      format: "markdown"
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
    },
    plugins: {
      paths: [
        "~/.claude/settings.json",
        "~/.claude/settings.local.json"
      ],
      key: "enabledPlugins",
      format: "map"
    },
    agents: {
      paths: [
        "~/.claude/commands",
        "./.claude/commands"
      ],
      format: "markdown"
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
    skills: null,
    plugins: null,
    agents: null
  },
  cursor: {
    name: "Cursor",
    mcpConfig: {
      paths: ["~/.cursor/mcp.json", "./.cursor/mcp.json"],
      key: "mcpServers"
    },
    skills: {
      paths: ["~/.cursor/skills", "./.cursor/rules"]
    },
    plugins: null,
    agents: null
  },
  windsurf: {
    name: "Windsurf",
    mcpConfig: {
      paths: ["~/.codeium/windsurf/mcp_config.json"],
      key: "mcpServers"
    },
    skills: {
      paths: ["~/.codeium/windsurf/skills"]
    },
    plugins: null,
    agents: null
  }
});
