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
    },
    rules: {
      paths: [
        "~/.config/opencode/AGENTS.md",
        "./AGENTS.md"
      ]
    },
    hooks: null
  },
  "claude-code": {
    name: "Claude Code",
    mcpConfig: {
      paths: ["~/.claude.json", "./.mcp.json"],
      key: "mcpServers"
    },
    skills: {
      paths: ["~/.claude/skills", "./.claude/skills"]
    },
    plugins: {
      paths: [
        "~/.claude/settings.json",
        "./.claude/settings.json",
        "./.claude/settings.local.json"
      ],
      key: "enabledPlugins",
      format: "map"
    },
    agents: {
      paths: [
        "~/.claude/agents",
        "./.claude/agents"
      ],
      format: "markdown"
    },
    rules: {
      paths: [
        "~/.claude/CLAUDE.md",
        "~/.claude/rules",
        "./CLAUDE.md",
        "./.claude/rules"
      ]
    },
    hooks: {
      paths: [
        "~/.claude/settings.json",
        "./.claude/settings.json",
        "./.claude/settings.local.json"
      ],
      key: "hooks"
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
    agents: null,
    rules: null,
    hooks: null
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
    agents: null,
    rules: {
      paths: [
        "./.cursor/rules",
        "./.cursorrules",
        "./AGENTS.md"
      ]
    },
    hooks: null
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
    agents: null,
    rules: {
      paths: [
        "~/.codeium/windsurf/memories/global_rules.md",
        "./.windsurfrules",
        "./.windsurf/rules"
      ]
    },
    hooks: null
  },
  agy: {
    name: "Antigravity",
    mcpConfig: {
      paths: [
        "~/.gemini/config/mcp_config.json",
        "~/.gemini/antigravity/mcp_config.json",
        "./.agents/mcp_config.json",
        "./.agent/mcp_config.json",
        "./_agents/mcp_config.json",
        "./_agent/mcp_config.json"
      ],
      key: "mcpServers"
    },
    skills: {
      paths: [
        "~/.gemini/config/skills",
        "./.agents/skills",
        "./.agent/skills",
        "./_agents/skills",
        "./_agent/skills"
      ]
    },
    plugins: {
      paths: ["~/.gemini/config/config.json"],
      key: "plugins",
      format: "directory",
      dirPaths: [
        "~/.gemini/config/plugins",
        "./.agents/plugins",
        "./.agent/plugins",
        "./_agents/plugins",
        "./_agent/plugins"
      ]
    },
    agents: {
      paths: [
        "~/.gemini/config/agents",
        "./.agents/agents",
        "./.agent/agents",
        "./_agents/agents",
        "./_agent/agents"
      ],
      format: "markdown"
    },
    rules: {
      paths: [
        "~/.gemini/GEMINI.md",
        "./GEMINI.md",
        "./AGENTS.md",
        "./.agents/rules",
        "./.agent/rules",
        "./_agents/rules",
        "./_agent/rules"
      ]
    },
    hooks: {
      paths: [
        "~/.gemini/config/hooks.json",
        "./.agents/hooks.json",
        "./.agent/hooks.json",
        "./_agents/hooks.json",
        "./_agent/hooks.json"
      ]
    }
  }
});
