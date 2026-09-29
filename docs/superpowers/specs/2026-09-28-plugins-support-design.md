# Architecture & Design Specification: Agent Plugins Lifecycle Support

**Date:** 2026-09-28  
**Status:** Approved  
**Author:** Antigravity / DeepMind Engineering Coordinator  
**Component:** `smcp` (Skills & MCP Package Manager)

---

## 1. Overview & Objectives

`smcp` enables bundling, sanitizing, sharing, and installing agent extensions across AI developer environments. While `smcp` currently manages **MCP Servers** and **Agent Skills**, modern agents (specifically OpenCode and Claude Code) also rely extensively on **Plugins** to provide runtime hooks, tools, providers, transforms, and marketplace integrations.

This specification details full lifecycle support for **Plugins** across agents:
1. **Discovery & Inspection:** Detect installed plugins in agent configurations (OpenCode `plugin`/`plugins` array and local files; Claude Code `enabledPlugins` map).
2. **Export & Sharing:** Bundle npm package plugins, marketplace plugins, and local plugin script files/directories into `smcp.json` packs and GitHub Gists.
3. **Inspection:** View plugin requirements and agent compatibility non-destructively before installation.
4. **Installation & Path Configuration:** Install plugin references into agent configs and extract local plugin scripts to designated or customized local plugin directories.
5. **Agent Profile Extensibility:** Allow registering custom agents with dedicated plugin config paths and local plugin directories via `smcp agent add`.

---

## 2. Data Models & Schemas (`src/types.ts`)

### 2.1 Plugin Entry Schema
```ts
export const PluginEntrySchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    targetAgent: z.string().optional(), // e.g. "opencode", "claude-code"
    description: z.string().optional(),
    path: z.string().optional(), // relative or local path if backed by files
    files: z.record(z.string(), z.string()).optional() // relPath -> file content for local scripts
  })
]);

export type PluginEntry = z.infer<typeof PluginEntrySchema>;
```

### 2.2 Manifest Schema Extension
The `ManifestSchema` in `src/types.ts` is updated:
```ts
export const ManifestSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  version: z.string().regex(SEMVER_REGEX),
  description: z.string().optional(),
  author: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional().default({}),
  skills: z.array(SkillEntrySchema).optional().default([]),
  plugins: z.array(PluginEntrySchema).optional().default([]),
  requiredEnv: z.array(RequiredEnvSchema).optional().default([])
});
```

### 2.3 Agent Profile Schema Extension
The `AgentProfileSchema` in `src/types.ts` is updated:
```ts
export const AgentProfileSchema = z.object({
  name: z.string(),
  mcpConfig: z
    .object({
      paths: z.array(z.string()),
      key: z.string().default("mcpServers")
    })
    .nullable()
    .optional(),
  skills: z
    .object({
      paths: z.array(z.string())
    })
    .nullable()
    .optional(),
  plugins: z
    .object({
      paths: z.array(z.string()),
      key: z.string().default("plugin"),
      format: z.enum(["array", "map"]).default("array"),
      dirPaths: z.array(z.string()).optional()
    })
    .nullable()
    .optional()
});
```

### 2.4 Detected Agent Schema Extension
`DetectedAgentSchema` adds:
```ts
export const DetectedAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mcpConfigPath: z.string().nullable(),
  skillsDirPath: z.string().nullable(),
  pluginsConfigPath: z.string().nullable().optional(),
  pluginsDirPath: z.string().nullable().optional()
});
```

---

## 3. Agent Profiles & Detection (`src/core/agents.ts`)

### 3.1 Default Agent Profiles
- **`opencode`**:
  ```ts
  plugins: {
    paths: [
      "./opencode.jsonc",
      "./opencode.json",
      "~/.config/opencode/opencode.jsonc",
      "~/.config/opencode/opencode.json"
    ],
    key: "plugin",
    format: "array",
    dirPaths: [
      "./plugin",
      "./.opencode/plugin",
      "~/.config/opencode/plugin"
    ]
  }
  ```
- **`claude-code`**:
  ```ts
  plugins: {
    paths: [
      "~/.claude/settings.json",
      "~/.claude/settings.local.json"
    ],
    key: "enabledPlugins",
    format: "map"
  }
  ```
- **`claude-desktop`**, **`cursor`**, **`windsurf`**: `plugins: null`.

### 3.2 Reading Installed Plugins (`readInstalledPlugins`)
```ts
export function readInstalledPlugins(
  configPath: string,
  key: string = "plugin",
  format: "array" | "map" = "array"
): PluginEntry[]
```
- In OpenCode:
  Reads JSON/JSONC with comments stripped via `stripJsonComments`. Checks `config[key]` (defaulting to `"plugin"`, with fallback to `"plugins"`).
  For each string, identifies if it's an npm package (e.g. `opencode-gemini-auth@latest`) or a local file/directory path (e.g. `./plugin/antigravity.ts`).
- In Claude Code:
  Reads `settings.json` under `enabledPlugins`. Extracts keys where the value is truthy (e.g. `superpowers@claude-plugins-official`).

---

## 4. Merging & Installation (`src/core/merger.ts`)

### 4.1 Config Merging (`mergePluginsIntoFile`)
```ts
export function mergePluginsIntoFile(
  filePath: string,
  plugins: (string | PluginEntry)[],
  key: string,
  format: "array" | "map"
): void
```
1. **Array Format (OpenCode)**:
   - Reads existing JSON/JSONC file.
   - Finds or creates array at `key` (or `"plugins"` if existing).
   - Appends new plugin names/paths, avoiding duplicates.
   - Writes back formatted content preserving comments where applicable.
2. **Map Format (Claude Code)**:
   - Reads existing JSON file.
   - Finds or creates object at `key` (e.g. `enabledPlugins`).
   - For each plugin, sets `config[key][pluginName] = true`.
   - Writes back formatted JSON.

### 4.2 Local Plugin File Extraction (`installPluginFiles`)
```ts
export function installPluginFiles(
  targetDir: string,
  pluginName: string,
  files: Record<string, string>
): void
```
- Validates file paths to strictly disallow `..`, absolute paths, or path traversal.
- Writes files under `targetDir` (or `path.join(targetDir, pluginName)` if multi-file).
- Ensures missing parent directories are created with secure permissions.

---

## 5. CLI Commands Update

### 5.1 `smcp list` (`src/commands/list.ts`)
- Displays `Plugins (N)` for each agent.
- In `--settings` / `--verbose` mode: displays individual plugin names, types (package vs local path), and active config files.
- In `--json` mode: output includes `plugins: PluginEntry[]` per agent object.

### 5.2 `smcp share` (`src/commands/share.ts`)
- Added flag: `-p, --plugins <plugins...>` to specify plugins to share.
- In interactive mode: provides a multi-select prompt for detected plugins.
- In non-interactive mode: bundles all detected plugins unless filtered.
- For local plugin files (e.g. `./plugin/code-search.ts`), reads file contents and includes them under `files` or Gist files `plugins_<name>_<file>` with content hashing.

### 5.3 `smcp inspect` (`src/commands/inspect.ts`)
- Displays a dedicated section for plugins bundled in the pack.
- In `--json` mode: includes `plugins: PluginEntry[]`.

### 5.4 `smcp install` (`src/commands/install.ts`)
- Added flag: `--plugin-dir <dir>` to override the local plugin installation path.
- Resolves plugins from manifest:
  - Filters by `targetAgent` if specified (e.g. skipping Claude-only plugins when installing into OpenCode, and vice versa).
  - Installs npm/marketplace references into agent configuration.
  - If a plugin has bundled files, extracts them to the agent's plugin directory (`plugins.dirPaths[0]` or `--plugin-dir`) and registers the resulting path.
- In `--json` mode: returns `installedPlugins: string[]` in the result payload.

### 5.5 `smcp agent add` (`src/commands/agent.ts`)
- Adds prompts for custom plugin paths:
  - *Plugins config file path (optional, e.g. ~/.config/opencode/opencode.jsonc):*
  - *Local plugins directory path (optional, e.g. ~/.config/opencode/plugin):*
- Saves `plugins` descriptor into `~/.smcp/custom-agents.json`.

---

## 6. Verification & Test Plan

1. **Unit Tests for Core Plugin Logic**:
   - `tests/agents.test.ts`: Test `readInstalledPlugins` for both array (OpenCode) and map (Claude Code) formats, including JSONC handling and custom keys.
   - `tests/merger.test.ts`: Test `mergePluginsIntoFile` for array appending without duplicate entries and map key setting. Test `installPluginFiles` for security and path traversal protection.
2. **Command Suite Tests**:
   - `tests/commands.test.ts`:
     - Test `listCommand` with plugins in text and `--json` mode.
     - Test `inspectCommand` displaying plugins.
     - Test `shareCommand` bundling local plugin files and packages.
     - Test `installCommand` installing plugins into OpenCode and Claude Code configurations.
     - Test `agentAddCommand` registering custom agent with plugin paths.
3. **End-to-End CLI Verification**:
   - Run `bun run build`.
   - Execute `node bin/smcp.js list -a opencode --json` and verify `plugins` are detected from user's `~/.config/opencode/opencode.jsonc`.
   - Execute `node bin/smcp.js list -a claude --json` and verify `plugins` are detected from user's `~/.claude/settings.json`.
   - Run the entire test suite (`bun test`) ensuring all 270+ tests pass with zero regressions.
