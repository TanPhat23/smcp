# @tanphat/smcp

[![npm version](https://img.shields.io/npm/v/@tanphat/smcp.svg)](https://www.npmjs.com/package/@tanphat/smcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Node & Bun](https://img.shields.io/badge/Runtime-Node%2018+%20%7C%20Bun-green.svg)](https://nodejs.org)

> **The Package Manager for AI Agent Skills, MCP Servers & Plugins.**  
> Interactively bundle, sanitize, version, share, and install agent stacks across OpenCode, Claude Code, Cursor, and Windsurf in seconds.

---

## 📦 Installation & Instant Usage

Run directly via `npx` or `bunx` (no installation required):

```bash
# Using npx
npx @tanphat/smcp <command>

# Using bunx
bunx @tanphat/smcp <command>
```

Or install globally on your machine:

```bash
# Using npm
npm install -g @tanphat/smcp

# Using Bun
bun add -g @tanphat/smcp

# Using pnpm
pnpm add -g @tanphat/smcp
```

Verify your installation:

```bash
smcp --version
# Output: 0.3.4
```

---

## ⚡ The Problem `smcp` Solves

Modern AI coding agents (OpenCode, Claude Code, Cursor, Windsurf) rely on two core components:
1. **Agent Skills:** System instructions, workflows, and task guidelines (`.opencode/skills`, `.claude/skills`, `.cursor/rules`).
2. **MCP Servers:** Model Context Protocol tool integrations (PostgreSQL, GitHub, Linear, Brave Search, etc.) configured in client-specific files (`opencode.json`, `~/.claude.json`, `.cursor/mcp.json`).

Sharing these configurations has traditionally been painful:
- ❌ **Configuration fragmentation:** Different agents use different folder layouts, JSON keys, and schemas.
- ❌ **Accidental secret leaks:** MCP server configs contain sensitive database passwords and API tokens that get leaked into git or chats.
- ❌ **Manual merging:** Team members have to copy-paste JSON snippets by hand and risk syntax errors.

**`smcp` bundles skills, MCP servers, and plugins into versioned "Agent Packs" with automatic secret redaction and one-command multi-agent installation.**

---

## 🚀 Common Commands

### 1. Discover Installed Skills, MCP Servers & Plugins
```bash
# Interactive table of all detected agents:
smcp list

# Output formatted JSON (ideal for AI agents & automation):
smcp list --json

# Target a specific agent:
smcp list -a opencode --json
smcp list -a claude --json

# View complete configurations (commands, arguments, env keys, file paths):
smcp list -a opencode --settings
```

### 2. Inspect an Agent Pack Before Installing
```bash
# Inspect a Gist or repository pack and its required environment variables:
smcp inspect https://gist.github.com/user/7f8a9b123456
smcp inspect github:owner/repo
smcp inspect ./my-local-pack
```

### 3. Install a Pack into Your Agents
```bash
# Interactive installation (guides you through selecting agents and env vars):
smcp install https://gist.github.com/user/7f8a9b123456

# Non-interactive / headless installation for AI agents & CI:
smcp install <source> -a opencode -f -y --json

# Pass required environment variables inline:
smcp install <source> -a opencode -f -y -e DB_PASSWORD=my_secret DB_URL=postgres://...

# Specify package runner runtime (e.g. npx for npm users, bunx for bun users):
smcp install <source> -a opencode -f -y -r npx

# Choose installation scope (global by default; project-local with --project):
smcp install <source> -a opencode -f -y --global
smcp install <source> -a opencode -f -y --project

# Emit agent-native env placeholders ({env:VAR} for OpenCode, ${VAR} for Claude):
smcp install <source> -a opencode -f -y --native-env
```

### 4. Check for Updates & Outdated Packs
```bash
# Check if any installed packs have newer versions available:
smcp outdated

# Machine-readable output for AI agents & CI:
smcp outdated --json
```

### 5. Update Installed Packs
```bash
# Update a specific installed pack:
smcp update my-pack

# Update all outdated packs automatically:
smcp update --all

# Non-interactive update with specific runtime:
smcp update my-pack -y -r npx --json
```

### 6. Uninstall / Remove an Agent Pack
```bash
# Cleanly remove MCP servers, skills, and plugins belonging to a pack:
smcp uninstall my-pack

# Non-interactive uninstall for AI agents:
smcp uninstall my-pack -y --json
```

### 7. Bundle & Share Skills, MCPs & Plugins
```bash
# Interactive wizard (select servers, skills, auto-redact secrets, publish):
smcp share

# Export locally to a folder without publishing:
smcp share -o ./my-agent-pack -a opencode -y

# Publish directly to a GitHub Gist:
smcp share -P gist

# Publish directly to a GitHub Repository (creates or updates repo):
smcp share -P repo -R my-org/my-pack --branch main
```

### 8. Manage Authentication
```bash
# Log in with GitHub PAT (requires 'gist' or 'repo' scope):
smcp auth login

# Check authentication status:
smcp auth status

# Log out:
smcp auth logout
```

### 9. Register Custom AI Agents
```bash
# Interactive CLI prompt to register a new editor or CLI agent:
smcp agent add

# List all supported agent profiles in JSON:
smcp agent list --json
```

---

## 🤖 AI Agent Integration Guide

`smcp` is built from the ground up for agent-to-agent collaboration:
1. **Always use `--json`**: Output is clean, structured JSON ready for parsing.
2. **Use non-interactive flags** (`-y` / `--yes` and `-f` / `--force`): Commands will never block on interactive terminal prompts.
3. **Inspect before installing**: Run `smcp inspect <source> --json` to inspect permissions and required environment variables before writing to disk.

```bash
# Complete AI Agent Guide:
smcp instructions
smcp instructions --json
```

---

## 🔌 Extensibility & Custom Plugins

`smcp` supports dynamic plugins and runtime configuration files (`smcp.config.js`, `smcp.config.mjs`, or `~/.smcp/plugins/*.js`). You can extend:
- **CLI Commands**: Add custom subcommands via `registerCliCommand()`.
- **Lifecycle Hooks**: `beforeShare`, `afterShare`, `beforeInstall`, `afterInstall`.
- **Storage Providers**: Swap file storage with SQLite, Keychain, or Redis via `registerStorageProvider()`.
- **Auth Providers**: Add GitLab, Bitbucket, or internal OAuth providers via `registerAuthProvider()`.
- **Pack Loaders**: Add custom URL schemes (e.g. `s3://`, `registry://`) via `registerPackLoader()`.

---

## 📚 Headless Core SDK

Need to integrate `smcp` features programmatically into a VS Code extension, web service, or background daemon? Check out the zero-terminal-dependency headless SDK:

👉 **[@tanphat/smcp-core](https://www.npmjs.com/package/@tanphat/smcp-core)**

---

## 📄 License

MIT © [Tấn Phát](https://github.com/TanPhat23)
