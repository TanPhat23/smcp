import pc from "picocolors";

export const SMCP_AGENT_SKILL_CONTENT = `---
name: smcp
description: Manage, list, inspect, share, and install Model Context Protocol (MCP) servers, Agent Skills, and Plugins across AI agents (OpenCode, Claude Code, Cursor, Windsurf).
---

# smcp — Agent Skills, MCP & Plugins Package Manager

CLI tool to bundle, sanitize, share, and install AI agent skills, MCP servers, and plugins across OpenCode, Claude Code, Cursor, and Windsurf.

## Quick Rules for AI Agents
1. **Always use \`--json\`** when running queries for fast, reliable parsing.
2. **Use non-interactive flags** (\`-y\` / \`--yes\` and \`-f\` / \`--force\`) so commands never block on interactive prompts.
3. **Target specific agents** using \`-a opencode\` or \`-a claude\`.

## Common Commands

### 1. Discover Installed Skills, MCP Servers & Plugins
\`\`\`bash
# List all agents, MCP servers, skills, and plugins in JSON:
smcp list --json

# List specific agent (e.g. OpenCode or Claude):
smcp list -a opencode --json
smcp list -a claude --json

# View full configurations (arguments, commands, env keys, config file paths):
smcp list -a opencode --settings
\`\`\`

### 2. Inspect a Pack Before Installation
\`\`\`bash
# Inspect a Gist or local pack manifest and required environment variables:
smcp inspect <gist-url-or-local-path> --json
\`\`\`

### 3. Install a Pack
\`\`\`bash
# Install non-interactively into a specific agent:
smcp install <gist-url-or-local-path> -a opencode -f -y --json

# Install with custom local plugin directory:
smcp install <gist-url-or-local-path> -a opencode --plugin-dir ~/.config/opencode/plugin -f -y --json

# Install with required environment variables:
smcp install <gist-url> -a opencode -f -y -e API_KEY=secret_val DB_URL=postgres://...
\`\`\`

### 4. Export / Share Skills, MCPs & Plugins
\`\`\`bash
# Export locally to a directory:
smcp share -o ./my-pack -a opencode -y --json

# Export specific servers, skills, and plugins:
smcp share -o ./my-pack -s context7 -k subagent-orchestration -p opencode-gemini-auth@latest -y --json
\`\`\`

### 5. Extensibility & Plugins Autoloader
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
