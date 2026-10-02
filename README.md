# smcp — Share & Install Agent Skills & MCP Servers

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun%201.3+-black.svg?logo=bun)](https://bun.sh)
[![Node: >=18](https://img.shields.io/badge/Node->=18-green.svg?logo=node.js)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-0.4.0-brightgreen.svg)](package.json)

> **The package manager for AI Agent Stacks.**  
> Interactively bundle, sanitize, version, and share **Agent Skills** and **Model Context Protocol (MCP)** server configurations across AI coding environments in seconds.

---

## 📦 Packages in this Monorepo

| Package | Version | Description |
| :--- | :--- | :--- |
| [**`@tanphat/smcp`**](packages/cli) | [![npm](https://img.shields.io/npm/v/@tanphat/smcp.svg)](https://www.npmjs.com/package/@tanphat/smcp) | Interactive CLI tool & multi-agent package manager (`smcp`) |
| [**`@tanphat/smcp-core`**](packages/core) | [![npm](https://img.shields.io/npm/v/@tanphat/smcp-core.svg)](https://www.npmjs.com/package/@tanphat/smcp-core) | Headless core SDK with zero terminal UI dependencies |

---

## ⚡ The Problem

Modern AI-assisted engineering relies on two foundational pillars:

1. **Agent Skills:** Markdown guidelines, system instructions, and specialized task workflows (stored in directories like `.claude/skills`, `.opencode/skills`, or `.cursor/rules`).
2. **MCP Servers:** Model Context Protocol tool integrations (PostgreSQL, GitHub, Linear, Brave Search, Figma, or custom internal microservices) configured in client-specific JSON manifests (`opencode.json`, `~/.claude.json`, `claude_desktop_config.json`, `.cursor/mcp.json`).

Until now, sharing an agent stack with your team or community has been painful:
- **Fragmented Configurations:** Skills live in different folder structures; MCP servers live in different JSON schemas across OpenCode, Claude Code, Claude Desktop, Cursor, and Windsurf.
- **Accidental Secret Leaks:** MCP configurations contain sensitive database passwords, connection strings, and personal access tokens. Sharing them via dotfiles or copy-pasting frequently leaks credentials into repositories or chat channels.
- **No Synchronization or Versioning:** Updating a skill or server config requires everyone on the team to manually locate files and merge JSON snippets by hand.

**`smcp` unifies skills and MCP servers into portable, versioned "Agent Packs" with automatic secret redaction, SHA-256 fingerprinting, and one-command multi-agent installation.**

---

## 📦 Installation & Instant Usage

Run instantly via `npx` or `bunx` without prior installation:

```bash
# Using npx (Node.js 18+)
npx @tanphat/smcp <command>

# Using bunx (Bun 1.1+)
bunx @tanphat/smcp <command>
```

Or install globally on your machine:

```bash
# Using npm
npm install -g @tanphat/smcp

# Using bun
bun add -g @tanphat/smcp
```

Verify your installation:

```bash
smcp --version
# Output: 0.4.0
```

---

## 🚀 Quick Start: 60-Second Walkthrough

### 1. Authenticate with GitHub
Publishing packs as GitHub Gists requires a GitHub Personal Access Token (PAT) with the `gist` permission:

```bash
smcp auth login
```
*(Token is stored locally with secure `0600` file permissions in `~/.smcp/config.json`, or read from `GITHUB_TOKEN`.)*

### 2. Bundle & Share an Agent Pack
Run `smcp share` (or `smcp export`). The CLI automatically scans all supported AI agents installed on your system:

```bash
smcp share
```

An interactive terminal interface guides you:
- Select which detected MCP servers to include (e.g. `postgres`, `github`).
- Select which skills to include (e.g. `nextjs-best-practices`, `code-review`).
- The engine automatically detects passwords, database URLs, and API tokens, redacting them to `${VAR}` placeholders.
- Provide a name and description.
- Choose whether to publish as a **Public** or **Secret (unlisted)** Gist.
- Receive a shareable install command: `npx smcp install https://gist.github.com/user/7f8a9b123456`

### 3. Inspect a Pack Before Installing
Safely verify the contents, required environment variables, and skills without modifying any local files:

```bash
smcp inspect https://gist.github.com/user/7f8a9b123456
```

### 4. Install into Any Agent
Install the pack across one or more AI agents in one command:

```bash
smcp install https://gist.github.com/user/7f8a9b123456

# Non-interactive / CI / AI Agent installation:
smcp install <source> -a opencode -f -y --json

# Scope: Global (~/.config/opencode) vs Project-local (./opencode.jsonc):
smcp install <source> -a opencode -f -y --global
smcp install <source> -a opencode -f -y --project

# Defer credentials using agent-native placeholders ({env:VAR} for OpenCode):
smcp install <source> -a opencode -f -y --native-env
```

- Select target agent(s) (OpenCode, Claude Code, Cursor, Windsurf, Claude Desktop).
- Enter values for required environment variables (secret credentials are masked in the terminal).
- Config files are safely updated with 2-space JSON formatting, and skill files are cleanly copied into place.

### 5. Check Updates & Upgrade Packs
```bash
# Check if any installed packs have updates available:
smcp outdated

# Upgrade a specific pack or all packs:
smcp update my-pack
smcp update --all
```

### 6. Uninstall a Pack
```bash
# Remove an installed pack and its MCP servers, skills, and plugins cleanly:
smcp uninstall my-pack
```

---

## 🛡️ Zero Secret Leakage: How Redaction Works

Security is the primary directive of `smcp`. The redaction engine prevents accidental credential exposure at export time and securely restores values at installation time.

```text
[ Local Agent Config ]
  DATABASE_URL: postgresql://admin:secret123@db.com:5432/main
  GITHUB_TOKEN: ghp_abc123def456xyz789
          │
          ▼
   [ smcp share ]  ──►  Deterministic Heuristic Scanner
          │              • Key pattern matching (*_KEY, *_TOKEN, *PASSWORD*, etc.)
          │              • Value pattern matching (ghp_*, sk-*, ey*, connection strings)
          ▼
[ smcp.json Manifest ]
  DATABASE_URL: "${POSTGRES_DATABASE_URL}"
  GITHUB_TOKEN: "${GITHUB_TOKEN}"
  requiredEnv:  [ { key: "POSTGRES_DATABASE_URL", isSecret: true }, ... ]
          │
          ▼
  [ smcp install ] ──►  Interactive masked prompts or process.env resolution
          │              Config merged cleanly into target agent
          ▼
[ Cleanly Configured Target Agent ]
```

### Detection Heuristics
- **Key-Name Inspection:** Automatically identifies keys containing `TOKEN`, `SECRET`, `KEY`, `PASSWORD`, `PASSWD`, `PASS`, `PASSPHRASE`, `CREDENTIAL`, `AUTH`, or `PRIVATE`.
- **Known Secret Token Formats:**
  - GitHub Classic PATs (`ghp_*`) and Fine-Grained PATs (`github_pat_*`)
  - OpenAI, Anthropic, Stripe API Keys (`sk-*`)
  - Slack Bot Tokens (`xoxb-*`)
  - HuggingFace Tokens (`hf_*`)
  - JSON Web Tokens (`ey*.*.*`)
- **Connection Strings & Database URLs:** Scans `args` and `env` for URIs containing embedded passwords (`protocol://user:pass@host:port/db`).
- **Remote MCP Server URLs:** Checks SSE / HTTP server URLs for embedded basic auth credentials or secret query parameters.
- **Idempotency:** Existing placeholders (such as `${MY_API_KEY}`) are preserved and not double-escaped.

---

## 🤖 Multi-Agent Ecosystem Support

`smcp` detects and configures both global and workspace-level agents out of the box:

| AI Agent | MCP Configuration Path(s) | Skills Directory |
| :--- | :--- | :--- |
| **OpenCode** | `~/.config/opencode/opencode.json`<br>`./opencode.json` | `~/.config/opencode/skills`<br>`./.opencode/skills` |
| **Claude Code** | `~/.claude.json`<br>`./.claude.json` | `~/.claude/skills`<br>`./skills` |
| **Claude Desktop** | `~/.config/Claude/claude_desktop_config.json`<br>`~/Library/Application Support/Claude/claude_desktop_config.json`<br>`%APPDATA%/Claude/claude_desktop_config.json` | *(MCP only)* |
| **Cursor** | `~/.cursor/mcp.json`<br>`./.cursor/mcp.json` | `~/.cursor/skills`<br>`./.cursor/rules` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` | `~/.codeium/windsurf/skills` |

### Custom Agent Profiles
Want to support an internal tool, a fork, or a new AI coding assistant? Register custom declarative agent profiles in seconds without modifying source code:

```bash
smcp agent add
```

Interactive prompts will ask for:
- Agent ID (e.g. `cline` or `custom-dev-agent`)
- Display Name (e.g. `Cline Extension`)
- Path to MCP configuration JSON file
- Path to Skills directory

Custom agent profiles are persisted to `~/.smcp/custom-agents.json` and are immediately available in `smcp share`, `smcp list`, and `smcp install`.

---

## 📖 CLI Command Reference

### `smcp share` / `smcp export`
Bundles and shares local skills and MCP servers to a GitHub Gist or local directory.

```bash
smcp share [options]
smcp export [options]
```

**Options:**
- `-o, --output <dir>`: Export to a local folder instead of publishing to GitHub Gist.
- `-a, --agents <agents...>`: Filter source agents to discover from (e.g. `-a opencode claude-code`).
- `-s, --servers <servers...>`: Explicitly select MCP servers by name (e.g. `-s postgres github`).
- `-k, --skills <skills...>`: Explicitly select skills by name (e.g. `-k nextjs-guidelines api-design`).
- `-n, --name <name>`: Pack slug name (e.g. `-n fullstack-pack`).
- `-d, --description <desc>`: Human-readable pack summary.

**Examples:**
```bash
# Interactive interactive share to GitHub Gist
smcp share

# Export to a local folder for version control in a Git repository
smcp share -o ./my-pack -s postgres github -k nextjs-best-practices

# Share non-interactively using CLI options
smcp share -o ./dist-pack -n my-stack -d "Production database & skills" -s db-server
```

When updating an existing pack, `smcp` computes SHA-256 content hashes of your configurations and skills, detects modifications, and offers an automatic patch version bump (e.g., `1.0.0` -> `1.0.1`) to update the existing Gist.

---

### `smcp install <source>` / `smcp add <source>`
Installs an agent pack from a GitHub Gist URL, Gist ID, or local directory into target AI agents.

```bash
smcp install <source> [options]
smcp add <source> [options]
```

**Options:**
- `-a, --agents <agents...>`: Target agents to install into (e.g. `-a opencode claude-code cursor`).
- `-f, --force`: Bypass conflict confirmation prompts, overwriting existing configurations.

**Supported Sources:**
- Full Gist URL: `smcp install https://gist.github.com/TanPhat23/7f8a9b123456`
- Raw Gist Hex ID: `smcp install 7f8a9b1234567890abcdef1234567890`
- Local Pack Directory: `smcp install ./my-pack`
- Direct Manifest File: `smcp install ./my-pack/smcp.json`

**Examples:**
```bash
# Interactive installation with agent selection and credential prompts
smcp install https://gist.github.com/TanPhat23/7f8a9b123456

# Non-interactive installation using pre-set environment variables
API_KEY="my-secret-key" smcp install ./my-pack -a opencode -f
```

---

### `smcp inspect <source>` / `smcp info <source>`
Inspects an agent pack's details, required environment variables, MCP servers, and skill file structures before installing.

```bash
smcp inspect <source>
smcp info <source>
```

**Output Details:**
- Pack metadata (name, version, description, created/updated timestamps).
- Required environment variables (marked `[secret]`, with current shell presence status).
- MCP server definitions (commands, args, URLs, and environment variables).
- Bundled skills and contained files.

**Example:**
```bash
smcp inspect https://gist.github.com/TanPhat23/7f8a9b123456
```

---

### `smcp list` / `smcp ls`
Scans and displays all detected AI agents, active MCP servers, and installed skills on your machine.

```bash
smcp list
smcp ls
```

**Example Output:**
```text
● OpenCode
  MCP Servers (~/.config/opencode/opencode.json):
    - postgres: npx -y @modelcontextprotocol/server-postgres
    - github: npx -y @modelcontextprotocol/server-github
  Skills (~/.config/opencode/skills):
    - nextjs-best-practices
    - typescript-guidelines

● Claude Code
  MCP Servers (~/.claude.json):
    (none)
  Skills (~/.claude/skills):
    - web-design-guidelines
```

---

### `smcp auth <subcommand>`
Manages GitHub Personal Access Token authentication for Gist publishing.

```bash
smcp auth login    # Interactively submit and verify a GitHub Personal Access Token
smcp auth status   # Verify token validity against GitHub API and show authenticated user
smcp auth logout   # Remove stored token from ~/.smcp/config.json
```

*(Note: You can also supply your token via the `GITHUB_TOKEN` environment variable.)*

---

### `smcp agent <subcommand>`
Inspects and registers declarative AI agent configuration profiles.

```bash
smcp agent list    # (alias: smcp agent ls) List all built-in and custom agent profiles
smcp agent add     # Interactively register a new agent profile
```

---

## 📄 Manifest Specification (`smcp.json`)

When an agent pack is exported or published to a Gist, it is structured around an `smcp.json` manifest:

```json
{
  "$schema": "https://smcp.dev/schema.json",
  "name": "fullstack-agent-pack",
  "version": "1.0.0",
  "description": "Production Next.js + PostgreSQL & GitHub agent stack",
  "author": "ghug",
  "createdAt": "2026-09-27T10:00:00.000Z",
  "updatedAt": "2026-09-27T10:00:00.000Z",
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "${POSTGRES_DATABASE_URL}"
      ]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  },
  "skills": [
    {
      "name": "nextjs-best-practices",
      "path": "skills/nextjs-best-practices/SKILL.md",
      "description": "Next.js App Router guidelines and best practices",
      "contentHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "files": {
        "SKILL.md": "# Next.js Guidelines\nAlways use server components when possible...\n",
        "routing.md": "# Routing Rules\n..."
      }
    }
  ],
  "requiredEnv": [
    {
      "key": "POSTGRES_DATABASE_URL",
      "description": "Connection string for postgres (postgresql://user:pass@host:5432/db)",
      "isSecret": true
    },
    {
      "key": "GITHUB_TOKEN",
      "description": "GitHub Personal Access Token with repo scope",
      "isSecret": true
    }
  ]
}
```

### Schema Fields
- `$schema`: Schema URL definition.
- `name`: Lowercase alphanumeric pack slug (hyphens and underscores allowed).
- `version`: Strict SemVer identifier (e.g. `1.0.0`).
- `description`: Human-readable pack summary.
- `mcpServers`: Map of MCP server names conforming to the standard Model Context Protocol server configuration specification (`command`, `args`, `env`, `url`).
- `skills`: Array of skill definitions containing name, description, SHA-256 content hash, and bundled markdown files.
- `requiredEnv`: Array of environment variables needed to restore redacted configuration placeholders.

---

## 🛠️ Local Development & Testing

`smcp` is built with [Bun](https://bun.sh) and TypeScript.

### Prerequisites
- [Bun](https://bun.sh) v1.1+ (or Node.js v18+)

### Setup
```bash
git clone https://github.com/TanPhat23/smcp.git
cd smcp
bun install
```

### Development Scripts
```bash
# Run CLI in development mode via Bun TypeScript runtime
bun run dev --help

# Run comprehensive test suite (215+ tests, sub-second execution)
bun test

# Run type checking
bun run typecheck

# Build universal self-contained Node.js bundle into dist/cli.js
bun run build

# Test the generated Node.js CLI binary
node bin/smcp.js --help
```

---

## 🔒 Security Practices

- **Zero Sensitive Data Storage:** Tokens and credentials provided during `smcp install` are injected exclusively into your local agent configurations. They are never written to `smcp.json` or transmitted to external servers.
- **Strict File Permissions:** Authentication tokens stored in `~/.smcp/config.json` are created with `0600` permissions (read/write by owner only).
- **Atomic File Writes:** Agent configurations are written atomically using temporary files and renamed in-place to prevent file corruption during interruptions. If malformed JSON is detected, a `.bak` backup copy is preserved automatically.
- **Path Traversal Protection:** Skill unpackers strictly enforce that relative file paths remain bounded within the destination directory.

---

## 📜 License

MIT License © 2026 [Tấn Phát](https://github.com/TanPhat23)
