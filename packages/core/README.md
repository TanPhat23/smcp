# @tanphat/smcp-core

[![npm version](https://img.shields.io/npm/v/@tanphat/smcp-core.svg)](https://www.npmjs.com/package/@tanphat/smcp-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Node & Bun](https://img.shields.io/badge/Runtime-Node%2018+%20%7C%20Bun-green.svg)](https://nodejs.org)

> **Headless TypeScript SDK for AI Agent Skills and Model Context Protocol (MCP) server stacks.**  
> Zero terminal UI dependencies. Ideal for VS Code extensions, web servers, agent daemons, CI pipelines, and IDE integrations.

---

## ⚡ Features

- 🛡️ **Zero Terminal Baggage:** Completely decoupled from terminal UI libraries (`commander`, `@clack/prompts`, `picocolors`). Only depends on `zod` and `axios`.
- 🔍 **AI Agent Detection:** Automatically detects configuration paths and schemas for OpenCode, Claude Code, Claude Desktop, Cursor, Windsurf, and custom IDEs.
- 🔒 **Deterministic Secret Redaction:** Context-aware regex engine scans connection strings, flags, URLs, and environment variables, safely replacing secrets with `${PLACEHOLDER}` variables.
- 📦 **Multi-Source Pack Engine:** Load, inspect, and parse agent packs from GitHub Gists, GitHub Repositories, local directories, or custom pack sources.
- 🔄 **Safe Config Merger:** Atomic file operations (`0o600` permissions), formatting preservation (2-space JSON / JSONC), and symlink-safe writes.
- 🔌 **Pluggable Architecture:** Full extensibility registries for `StorageProvider`, `AuthProvider`, `PackLoader`, `McpAdapter`, `ShareProvider`, and async `Lifecycle Hooks`.

---

## 📦 Installation

```bash
# Using npm
npm install @tanphat/smcp-core

# Using Bun
bun add @tanphat/smcp-core

# Using pnpm
pnpm add @tanphat/smcp-core
```

---

## 🚀 Quick Usage

### 1. Load and Inspect an Agent Pack

```typescript
import { loadPackFromSource, collectRequiredEnv } from "@tanphat/smcp-core";

// Load pack from Gist, GitHub repo, or local filesystem
const pack = await loadPackFromSource("https://gist.github.com/user/7f8a9b123456");

console.log("Pack name:", pack.manifest.name);
console.log("MCP servers:", Object.keys(pack.manifest.mcpServers || {}));
console.log("Skills:", pack.manifest.skills?.map((s) => s.name));

// Collect required environment variables (including templated placeholders)
const requiredEnv = collectRequiredEnv(pack.manifest);
console.log("Required Env:", requiredEnv);
```

### 2. Sanitize and Redact Sensitive MCP Configurations

```typescript
import { redactMcpServers } from "@tanphat/smcp-core";

const rawServers = {
  dbServer: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://admin:secret123@db.internal:5432/prod"],
    env: {
      API_SECRET_KEY: "sk-live-abcdef123456"
    }
  }
};

const { redactedServers, requiredEnv } = redactMcpServers(rawServers);

// Database credentials and API keys are automatically replaced with safe placeholders:
console.log(JSON.stringify(redactedServers, null, 2));
// args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"]
// env: { API_SECRET_KEY: "${DB_SERVER_API_SECRET_KEY}" }
```

### 3. Detect Installed AI Agents

```typescript
import { detectAgents, getAgentProfiles } from "@tanphat/smcp-core";

// Detect agents available on current machine (OpenCode, Claude, Cursor, Windsurf, etc.)
const detected = detectAgents();
for (const agent of detected) {
  console.log(`Agent: ${agent.name} (installed: ${agent.installed})`);
  console.log(`Config path: ${agent.configPath}`);
}
```

### 4. Merge MCP Servers & Install Skills

```typescript
import { mergeMcpServersIntoFile, installSkillFiles } from "@tanphat/smcp-core";

// Atomically merge MCP servers into client configuration file
mergeMcpServersIntoFile(
  "/path/to/opencode.json",
  redactedServers,
  "mcp" // Target schema key
);

// Install agent skill files safely into agent skill directory
installSkillFiles(
  "/path/to/.opencode/skills",
  "my-skill",
  {
    "SKILL.md": "# My Skill\nInstructions here...",
    "helper.py": "print('hello')"
  }
);
```

### 5. Hook into the Lifecycle Pipeline

```typescript
import { registerHook, triggerHook } from "@tanphat/smcp-core";

// Intercept or audit lifecycle events
registerHook("beforeInstall", async (ctx) => {
  console.log(`Installing pack ${ctx.manifest.name} into agents:`, ctx.targetAgents);
});

registerHook("afterInstall", (ctx) => {
  console.log(`Successfully installed pack: ${ctx.manifest.name}`);
});
```

### 6. Register Custom Agents or Storage

```typescript
import { registerAgentProfile, registerStorageProvider, type StorageProvider } from "@tanphat/smcp-core";

// Register custom in-memory agent
registerAgentProfile("custom-ide", {
  name: "My Custom IDE",
  mcpConfig: {
    paths: ["~/.config/custom-ide/mcp.json"],
    key: "mcpServers"
  },
  skills: {
    baseDir: "~/.config/custom-ide/skills"
  }
});
```

---

## 🛠️ Exported Modules

- **`types/`**: Zod schemas & TypeScript types (`ManifestSchema`, `AgentProfileSchema`, `McpServerConfigSchema`, `SkillEntrySchema`, `PluginEntrySchema`, etc.).
- **`core/agents/`**: Detection, filtering, JSONC parsers, profile management.
- **`core/redactor/`**: Extensible secret detection, pattern registry, and token redactor.
- **`core/merger/`**: Multi-agent config merger, MCP schema adapters, and skill/plugin installers.
- **`core/pack/`**: Unified pack loader (Gists, repos, directories), required env collection.
- **`core/state/`**: Local storage engine, credential isolation, and shares history.
- **`core/lifecycle/`**: Async event hook execution engine.
- **`core/http.ts`**: Unified HTTP client with connection caching and Axios-compatible interface.
- **`utils/`**: SHA-256 / object hashing, atomic file writing, safe path expansion, prototype pollution defenses.

---

## 📄 License

MIT © [Tấn Phát](https://github.com/TanPhat23)
