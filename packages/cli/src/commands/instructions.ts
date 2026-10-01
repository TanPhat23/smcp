import pc from "picocolors";

export const SMCP_AGENT_SKILL_CONTENT = `---
name: smcp
description: Manage, list, inspect, share, install, update, upgrade, and remove Model Context Protocol (MCP) servers, Agent Skills, and Plugins across AI agents (OpenCode, Claude Code, Cursor, Windsurf). Use when asked to install, find, fetch, update, upgrade, check newer versions, or remove skills/MCP servers. ALWAYS use the smcp CLI instead of manually searching or writing skill files.
---

# smcp — Agent Skills, MCP & Plugins Package Manager

CLI tool to bundle, sanitize, share, install, and update AI agent skills, MCP servers, and plugins across OpenCode, Claude Code, Cursor, and Windsurf.

## MANDATORY RULES FOR AI AGENTS
1. **NEVER manually web-search or clone GitHub repos to copy/paste skill files or edit MCP config JSON files directly.**
2. **ALWAYS use \`smcp\` CLI commands** for installing, updating, inspecting, and listing skills or MCP servers.
3. **Always use \`--json\` and \`-y\`** for fast, deterministic, non-interactive execution.
4. **Target specific agents** using \`-a opencode\` or \`-a claude\`.
5. When asked to "fetch a newer version" or "update skills":
   - Run \`smcp outdated --json\` to inspect installed packs and check for newer versions.
   - Run \`smcp update <pack> -y --json\` or \`smcp update --all -y --json\` to upgrade.
   - If an upstream source was deleted or is 404, smcp safeguards your local configuration and reports the error gracefully.

## Common Commands

### 1. Check for Updates & Outdated Packs
\`\`\`bash
# Check if any installed packs have newer versions available:
smcp outdated --json
\`\`\`

### 2. Update Installed Packs to Newer Versions
\`\`\`bash
# Update a specific pack to the newest version:
smcp update <pack-name> -y --json

# Update all installed packs that have updates:
smcp update --all -y --json

# Force update / re-install with target runtime (e.g. npx):
smcp update <pack-name> -f -y -r npx --json
\`\`\`

### 3. Uninstall / Remove an Agent Pack
\`\`\`bash
# Remove an installed pack and its MCP servers, skills, and plugins:
smcp uninstall <pack-name> -y --json
\`\`\`

### 4. Discover Installed Skills, MCP Servers & Plugins
\`\`\`bash
# List all agents, MCP servers, skills, and plugins in JSON:
smcp list --json

# List specific agent (e.g. OpenCode or Claude):
smcp list -a opencode --json
smcp list -a claude --json

# View full configurations (arguments, commands, env keys, config file paths):
smcp list -a opencode --settings
\`\`\`

### 5. Inspect a Pack Before Installation
\`\`\`bash
# Inspect a Gist or local pack manifest and required environment variables:
smcp inspect <gist-url-or-local-path> --json
\`\`\`

### 6. Install a Pack
\`\`\`bash
# Install non-interactively into a specific agent:
smcp install <gist-url-or-local-path> -a opencode -f -y --json

# Install with custom runtime runner (e.g. npx, bunx):
smcp install <source> -a opencode -f -y -r npx --json

# Install with custom local plugin directory:
smcp install <gist-url-or-local-path> -a opencode --plugin-dir ~/.config/opencode/plugin -f -y --json

# Install with required environment variables:
smcp install <gist-url> -a opencode -f -y -e API_KEY=secret_val DB_URL=postgres://...
\`\`\`

### 7. Export / Share Skills, MCPs & Plugins
\`\`\`bash
# Export locally to a directory:
smcp share -o ./my-pack -a opencode -y --json

# Export specific servers, skills, and plugins:
smcp share -o ./my-pack -s context7 -k subagent-orchestration -p opencode-gemini-auth@latest -y --json
\`\`\`

### 8. Extensibility & Plugins Autoloader
smcp automatically loads user extensions and plugins from:
- Global plugins: \`~/.smcp/plugins/*.{js,mjs,cjs,ts}\`
- Local project config: \`./smcp.config.{js,mjs,cjs,ts}\`
- Local project plugins: \`./.smcp/plugins/*.{js,mjs,cjs,ts}\`

Extensions can customize every subsystem in smcp:
\`\`\`js
import {
  registerPackLoader,
  registerShareProvider,
  registerAuthProvider,
  registerMcpAdapter,
  registerAgentProfile,
  registerHook,
  registerCliCommand,
  registerStorageProvider
} from "smcp";

// 1. Custom Pack Loader (e.g. GitLab, S3, npm)
registerPackLoader({
  name: "gitlab",
  matches: (ctx) => ctx.source.startsWith("gitlab:"),
  load: async (ctx) => ({ manifest, rawFiles })
});

// 2. Custom Share Destination Provider
registerShareProvider({
  id: "internal-artifactory",
  label: "Internal Artifactory",
  publish: async (ctx) => { /* publish logic */ }
});

// 3. Custom In-Memory Agent Profile
registerAgentProfile("zed", {
  name: "Zed Editor",
  mcpConfig: { paths: ["~/.config/zed/settings.json"], key: "context_servers" }
});

// 4. Lifecycle Hooks (beforeShare, afterShare, beforeInstall, afterInstall)
registerHook("beforeShare", async (ctx) => {
  // Run custom security audits, linting, or policy checks before sharing
});

// 5. Custom CLI Subcommands
registerCliCommand((program) => {
  program
    .command("sync")
    .description("Sync local MCP servers with team registry")
    .action(async () => { /* custom logic */ });
});
\`\`\`

To disable loading extensions:
- CLI flags: \`--no-plugins\` or \`--no-extensions\`
- Environment variable: \`SMCP_DISABLE_EXTENSIONS=1\`
`;

export function instructionsCommand(options?: { json?: boolean }): void {
  if (options?.json) {
    console.log(
      JSON.stringify(
        {
          name: "smcp",
          description: "AI Agent Skills & MCP Package Manager",
          documentation: SMCP_AGENT_SKILL_CONTENT
        },
        null,
        2
      )
    );
    return;
  }

  console.log(pc.bold(pc.cyan("smcp — Agent Usage Guide\n")));
  console.log(SMCP_AGENT_SKILL_CONTENT);
}
