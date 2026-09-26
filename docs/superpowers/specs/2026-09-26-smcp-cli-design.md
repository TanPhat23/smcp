# Specification: `smcp` — Skill & MCP Sharing CLI

**Date:** 2026-09-26  
**Status:** Approved for Implementation  
**Package:** `smcp` (Node.js CLI via npm / npx)

---

## 1. Executive Summary & Problem Statement

Modern AI-assisted development workflows rely on two core components:
1. **Agent Skills:** Structured instructions, guidelines, domain workflows, and prompts (e.g., in `.claude/skills` or `.opencode/skills`).
2. **MCP Servers:** Model Context Protocol tool integrations and external resources (e.g., PostgreSQL, GitHub, Linear, Brave Search) defined in configuration files such as `opencode.json`, `claude_desktop_config.json`, or `.cursor/mcp.json`.

Currently, developers have no automated or safe way to bundle, sanitize, and share these two interdependent pieces with teammates or the community. Sharing requires manual file copying, manual JSON editing, and risks leaking sensitive API keys or database passwords.

`smcp` is an open-source, npm-distributed CLI tool that enables developers to:
- Interactively bundle selected local skills and MCP servers into an "Agent Pack".
- Automatically redact secrets and generate environment variable templates.
- Publish packs to GitHub Gists or Git repositories using a GitHub Personal Access Token (PAT).
- Track shared packs with content fingerprinting (SHA-256) for deterministic update detection.
- Install and update packs across multiple AI agents (OpenCode, Claude Code, Claude Desktop, Cursor, Windsurf, Cline) with one command.
- Add support for new or proprietary AI agents declaratively without core code modifications.

---

## 2. Architecture & Data Model

### 2.1 The Agent Pack Manifest (`smcp.json`)

When an agent pack is exported or published, it produces an `smcp.json` manifest along with referenced skill markdown files:

```json
{
  "$schema": "https://smcp.dev/schema.json",
  "name": "fullstack-pack",
  "version": "1.0.0",
  "description": "Next.js + Postgres & GitHub Agent Stack",
  "author": "ghug",
  "createdAt": "2026-09-26T10:00:00Z",
  "updatedAt": "2026-09-26T10:00:00Z",
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"]
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
      "contentHash": "sha256-a1b2c3d4..."
    }
  ],
  "requiredEnv": [
    {
      "key": "DATABASE_URL",
      "description": "PostgreSQL connection string (e.g. postgresql://user:pass@localhost:5432/db)",
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

### 2.2 Declarative Agent Profiles (`agents.json`)

To support arbitrary AI agents without hardcoding them into TypeScript logic, `smcp` uses declarative profiles:

```json
{
  "opencode": {
    "name": "OpenCode",
    "mcpConfig": {
      "paths": ["~/.config/opencode/opencode.json", "./opencode.json"],
      "key": "mcpServers"
    },
    "skills": {
      "paths": ["~/.config/opencode/skills", "./.opencode/skills"]
    }
  },
  "claude-code": {
    "name": "Claude Code",
    "mcpConfig": {
      "paths": ["~/.claude.json", "./.claude.json"],
      "key": "mcpServers"
    },
    "skills": {
      "paths": ["~/.claude/skills", "./skills"]
    }
  },
  "claude-desktop": {
    "name": "Claude Desktop",
    "mcpConfig": {
      "paths": [
        "~/.config/Claude/claude_desktop_config.json",
        "~/Library/Application Support/Claude/claude_desktop_config.json",
        "%APPDATA%/Claude/claude_desktop_config.json"
      ],
      "key": "mcpServers"
    },
    "skills": null
  },
  "cursor": {
    "name": "Cursor",
    "mcpConfig": {
      "paths": ["~/.cursor/mcp.json", "./.cursor/mcp.json"],
      "key": "mcpServers"
    },
    "skills": {
      "paths": ["~/.cursor/skills", "./.cursor/rules"]
    }
  },
  "windsurf": {
    "name": "Windsurf",
    "mcpConfig": {
      "paths": ["~/.codeium/windsurf/mcp_config.json"],
      "key": "mcpServers"
    },
    "skills": {
      "paths": ["~/.codeium/windsurf/skills"]
    }
  }
}
```

Custom agents added by users via `smcp agent add` are persisted into `~/.smcp/custom-agents.json` and merged with built-in profiles at runtime.

### 2.3 Local State & History Tracking (`~/.smcp/shares.json`)

Tracks previously shared packs and their content fingerprints:

```json
{
  "shares": [
    {
      "name": "fullstack-pack",
      "version": "1.0.0",
      "targetType": "gist",
      "targetUrl": "https://gist.github.com/ghug/7f8a9b123456",
      "gistId": "7f8a9b123456",
      "lastSharedAt": "2026-09-26T10:00:00Z",
      "fingerprints": {
        "mcpServers": {
          "postgres": "7b0d23...",
          "github": "89ec41..."
        },
        "skills": {
          "nextjs-best-practices": "e3b0c4..."
        }
      }
    }
  ]
}
```

---

## 3. Core CLI Workflows & UX Specification

### 3.1 Command Overview

```text
Usage: smcp [command] [options]

Commands:
  share, export               Bundle and publish local skills and MCPs to GitHub Gist or folder
  install, add <source>       Install skills & MCPs from Gist URL, GitHub repo, or local path
  list, ls                    List installed skills and MCP servers across detected agents
  inspect, info <source>      Preview contents, required env, and skills of a pack before installing
  auth <login|logout|status>  Manage GitHub Personal Access Token authentication
  agent <list|add|remove>     Manage supported agent profiles
```

### 3.2 Share Workflow (`smcp share`)
1. **Agent Discovery:** Scans all configured agent profiles. Reports detected tools with checkmarks.
2. **Selection Prompts (Interactive via `@clack/prompts`):**
   - Multi-select MCP servers found across detected agents.
   - Multi-select skills found across detected agents.
3. **Secret Redaction & Env Analysis:**
   - Detects token patterns (`ghp_*`, `sk-*`, `ey*`, standard regex for secrets) and keys matching `*_KEY`, `*_TOKEN`, `*_SECRET`, `*PASSWORD*`, `*URL*`.
   - Replaces literal secrets with `${VARIABLE_NAME}` templates.
   - Populates `requiredEnv` array in `smcp.json`.
4. **Change Detection & Versioning:**
   - If an existing share for this pack name is found in `~/.smcp/shares.json`:
     - Calculates SHA-256 fingerprints of selected skills and server configurations.
     - If changes exist, prompts:
       * `[1] Update existing Gist (bumps patch version, e.g. 1.0.0 -> 1.0.1)`
       * `[2] Create a new standalone Gist / pack`
       * `[3] Cancel`
5. **Publishing via GitHub PAT:**
   - If PAT is missing, prompts user for token (with direct link to create a token with `gist` scope), validates via `GET https://api.github.com/user`, and writes to `~/.smcp/config.json` with permissions `0600`.
   - Calls GitHub Gist API:
     - New Gist: `POST https://api.github.com/gists`
     - Update Gist: `PATCH https://api.github.com/gists/{gist_id}`
   - Updates `~/.smcp/shares.json`.
   - Outputs ready-to-use install command: `npx smcp install <gist_url>`.

### 3.3 Install Workflow (`smcp install <source>`)
1. **Source Resolution:** Supports GitHub Gist URLs, Gist IDs, GitHub Repo URLs (`user/repo` or full URL), and local directory paths.
2. **Fetch & Validation:** Downloads `smcp.json` and parses schema using `zod`.
3. **Target Agent Selection:** Multi-select prompts which detected agents to install into (e.g. OpenCode, Claude Code, Cursor).
4. **Environment Configuration:**
   - For each item in `requiredEnv`:
     - Checks if variable is already present in `process.env`.
     - If missing, prompts user with description (password-masked if marked secret).
5. **Conflict Detection & Safe Merging:**
   - If a skill or MCP server already exists in the target agent:
     - Prompts user: `[1] Overwrite with incoming version [2] Keep existing (skip) [3] View diff`.
   - For MCP servers: parses target agent's JSON config, cleanly inserts new servers into `mcpServers`, preserves formatting and indentation (2 spaces).
   - For skills: copies markdown files/directories into the agent's designated skills folder.

---

## 4. Technical Stack & Implementation Details

- **Runtime:** Node.js (>= 18.0.0), ECMAScript Modules (`"type": "module"`).
- **Language:** TypeScript 5.x compiled with `tsc` to `dist/`.
- **CLI Framework:** `commander` for command routing and argument parsing.
- **Terminal UI / Prompts:** `@clack/prompts` and `picocolors` for interactive menus and clean terminal styling.
- **Validation:** `zod` for strict runtime validation of manifests and agent profiles.
- **HTTP / GitHub Client:** Native Node.js `fetch` (zero heavy external client dependencies).
- **Testing:** `vitest` for fast, modern unit and integration tests.

---

## 5. Security & Safety Principles

1. **Zero Secret Leakage:**
   - The CLI strictly forbids publishing raw API keys or passwords.
   - Redaction engine scans both environment variable values and command-line arguments (e.g. database connection strings with passwords).
2. **Strict Credential File Permissions:**
   - `~/.smcp/config.json` is created with mode `0600` (readable and writable only by the owner).
3. **Atomic & Safe Config Writes:**
   - Agent config files (`opencode.json`, `claude_desktop_config.json`, etc.) are backed up or written atomically to avoid corruption on unexpected process exits.

---

## 6. Testing Strategy

1. **Unit Tests:**
   - `redactor.test.ts`: Tests secret identification and `${VAR}` placeholder replacement.
   - `fingerprint.test.ts`: Verifies SHA-256 hash generation for files and JSON objects.
   - `agentRegistry.test.ts`: Tests profile loading, path expansion (`~` and environment vars), and custom agent additions.
   - `manifest.test.ts`: Validates Zod schema parsing and error formatting for `smcp.json`.
2. **Integration / Mock Tests:**
   - `github.test.ts`: Tests Gist creation and patching using mocked `fetch` responses.
   - `installer.test.ts`: Tests merging MCP servers into mock JSON configs and writing skill files into mock directories.
