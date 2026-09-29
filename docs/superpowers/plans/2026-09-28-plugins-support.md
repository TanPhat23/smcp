# Plugins Lifecycle & High-Efficiency File Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full lifecycle support (discover, list, inspect, share, install, and custom paths) for AI Agent Plugins across OpenCode, Claude Code, and custom agent profiles, powered by a high-efficiency async file bundling and ignore engine.

**Architecture:**
1. **High-Efficiency File Engine (`src/utils/fs.ts`):** Fast async directory traversal with smart ignore filters (`.git`, `node_modules`, caches, `.gitignore`), file size guardrails, parallel async concurrency pools, and atomic async writes.
2. **Data Contracts (`src/types.ts`):** `PluginEntrySchema`, `PluginEntry`, and updated `ManifestSchema`, `AgentProfileSchema`, `DetectedAgentSchema`.
3. **Agent Profiles & Discovery (`src/core/agents.ts`):** Agent profile definitions with plugin config and directory paths; `readInstalledPlugins` supporting JSONC array (`OpenCode`) and map (`Claude Code`).
4. **Merger & File Installation (`src/core/merger.ts`):** `mergePluginsIntoFile` (array and map) and `installPluginFiles` with strict path traversal protection.
5. **CLI Integration (`src/commands/*`, `src/cli.ts`):** Support `--plugins` (`-p`) on `share`, `--plugin-dir` on `install`, `--json` output across commands, and plugin registration in `agent add`.

**Tech Stack:** TypeScript, Bun, Commander.js, Zod, Picocolors, Clack Prompts.

---

### File Structure Map

- `src/utils/fs.ts`: High-efficiency async directory walker, parallel file reader, ignore rules, atomic async file writer.
- `src/types.ts`: Define `PluginEntrySchema`, `PluginEntry`, and extend `ManifestSchema`, `AgentProfileSchema`, `DetectedAgentSchema`.
- `src/core/agents.ts`: Update `DEFAULT_AGENTS` with `plugins` settings; implement `readInstalledPlugins`; update `detectAgents`.
- `src/core/merger.ts`: Implement `mergePluginsIntoFile` (array and map formats) and `installPluginFiles`.
- `src/core/pack.ts`: Extend manifest loading and packaging to preserve and bundle local plugin files using the high-efficiency file engine.
- `src/commands/list.ts`: Display plugins in human text and structured `--json`.
- `src/commands/inspect.ts`: Display pack plugins in human text and structured `--json`.
- `src/commands/share.ts`: Support `-p, --plugins` option and bundle local plugin files or packages via the fast file engine.
- `src/commands/install.ts`: Support `--plugin-dir` option and install plugins into target agent configs and directories.
- `src/commands/agent.ts`: Add plugin config and directory prompts to `agentAddCommand`.
- `src/commands/instructions.ts`: Add plugin usage instructions to agent skill template.
- `src/cli.ts`: Register `-p, --plugins` and `--plugin-dir` flags on `share` and `install` commands.
- `tests/fs.test.ts`: Tests for high-efficiency file engine, ignore filters, and concurrency.
- `tests/agents.test.ts`: Unit tests for `readInstalledPlugins` and agent profile plugin detection.
- `tests/merger.test.ts`: Unit tests for `mergePluginsIntoFile` and `installPluginFiles`.
- `tests/commands.test.ts`: Integration tests for `list`, `inspect`, `share`, `install`, and `agent add` with plugins.
- `tests/cli.test.ts`: CLI flag registration and parsing tests.

---

### Task 0: High-Efficiency File Bundler & Ignore Engine (`src/utils/fs.ts`)

**Files:**
- Modify: `src/utils/fs.ts`
- Create: `tests/fs.test.ts`

- [ ] **Step 1: Write the failing tests for high-efficiency file bundling**

Create `tests/fs.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  atomicWriteFileAsync,
  collectDirectoryFilesAsync,
  isIgnoredPath
} from "../src/utils/fs.ts";

describe("High-Efficiency File Engine", () => {
  it("filters out default ignored patterns like node_modules and .git", () => {
    expect(isIgnoredPath(".git/config")).toBe(true);
    expect(isIgnoredPath("node_modules/pkg/index.js")).toBe(true);
    expect(isIgnoredPath(".DS_Store")).toBe(true);
    expect(isIgnoredPath("dist/bundle.js")).toBe(true);
    expect(isIgnoredPath("src/index.ts")).toBe(false);
  });

  it("collectDirectoryFilesAsync collects files concurrently while skipping ignored dirs", async () => {
    const tmp = path.join(os.tmpdir(), "smcp-fs-test-" + Date.now());
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules", "junk"), { recursive: true });

    fs.writeFileSync(path.join(tmp, "src", "a.ts"), "content-a");
    fs.writeFileSync(path.join(tmp, "src", "b.ts"), "content-b");
    fs.writeFileSync(path.join(tmp, "node_modules", "junk", "bad.js"), "junk");

    const files = await collectDirectoryFilesAsync(tmp);
    expect(Object.keys(files)).toContain("src/a.ts");
    expect(Object.keys(files)).toContain("src/b.ts");
    expect(Object.keys(files)).not.toContain("node_modules/junk/bad.js");
    expect(files["src/a.ts"]).toBe("content-a");
  });

  it("atomicWriteFileAsync writes files safely and non-destructively", async () => {
    const tmpFile = path.join(os.tmpdir(), "smcp-write-test-" + Date.now() + ".txt");
    await atomicWriteFileAsync(tmpFile, "hello world");
    expect(fs.readFileSync(tmpFile, "utf8")).toBe("hello world");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/fs.test.ts`  
Expected: FAIL (`collectDirectoryFilesAsync` / `isIgnoredPath` not found).

- [ ] **Step 3: Implement high-efficiency file engine in `src/utils/fs.ts`**

Add to `src/utils/fs.ts`:
- `DEFAULT_IGNORE_PATTERNS`: `.git`, `node_modules`, `dist`, `build`, `.cache`, `.turbo`, `.next`, `.DS_Store`, `*.pyc`, `*.log`, `*.tmp`.
- `isIgnoredPath(relPath: string, customIgnores?: string[]): boolean`.
- `pLimit(concurrency: number)`: In-memory concurrency pool for Bun/Node without extra runtime dependencies.
- `collectDirectoryFilesAsync(rootDir: string, options?: { maxFileSize?: number; customIgnores?: string[] }): Promise<Record<string, string>>`.
  - Walks directories asynchronously using `fs.promises.readdir(dir, { withFileTypes: true })`.
  - Skips ignored directories entirely without recursing.
  - Reads matching files concurrently with `pLimit(16)`.
  - Skips files exceeding `maxFileSize` (default 2MB) or binary files.
- `atomicWriteFileAsync(filePath: string, content: string, options?: AtomicWriteOptions): Promise<void>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/fs.test.ts`  
Expected: PASS.

---

### Task 1: Extend Types & Schemas (`src/types.ts`)

**Files:**
- Modify: `src/types.ts`
- Test: `tests/pack.test.ts`

- [ ] **Step 1: Write the failing test for plugin schema validation**

Add to `tests/pack.test.ts`:
```ts
it("validates manifests with plugin entries (strings and objects)", () => {
  const rawManifest = {
    name: "plugin-pack",
    version: "1.0.0",
    description: "Pack with plugins",
    plugins: [
      "opencode-gemini-auth@latest",
      {
        name: "custom-plugin",
        targetAgent: "opencode",
        description: "Local custom plugin",
        path: "./plugin/custom.ts",
        files: { "custom.ts": "console.log('plugin');" }
      }
    ]
  };

  const parsed = ManifestSchema.parse(rawManifest);
  expect(parsed.plugins).toBeDefined();
  expect(parsed.plugins?.length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/pack.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement plugin schema extensions in `src/types.ts`**

Update `src/types.ts` with `PluginEntrySchema`, `PluginEntry`, and updated `ManifestSchema`, `AgentProfileSchema`, `DetectedAgentSchema`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/pack.test.ts`  
Expected: PASS.

---

### Task 2: Core Agent Profiles & Plugin Discovery (`src/core/agents.ts`)

**Files:**
- Modify: `src/core/agents.ts`
- Test: `tests/agents.test.ts`

- [ ] **Step 1: Write the failing tests for plugin discovery**

Add to `tests/agents.test.ts`:
```ts
describe("readInstalledPlugins", () => {
  it("reads array format plugins from OpenCode JSONC (plugin and plugins keys)", () => {
    const opencodePath = path.join(testDir, "opencode.jsonc");
    fs.writeFileSync(
      opencodePath,
      `{\n  // plugins comment\n  "plugin": ["opencode-gemini-auth@latest", "./plugin/antigravity.ts"]\n}`,
      "utf8"
    );

    const plugins = readInstalledPlugins(opencodePath, "plugin", "array");
    expect(plugins.map((p) => (typeof p === "string" ? p : p.name))).toEqual([
      "opencode-gemini-auth@latest",
      "./plugin/antigravity.ts"
    ]);
  });

  it("reads map format plugins from Claude Code settings.json (enabledPlugins)", () => {
    const claudePath = path.join(testDir, "settings.json");
    fs.writeFileSync(
      claudePath,
      JSON.stringify({
        enabledPlugins: {
          "superpowers@claude-plugins-official": true,
          "disabled-plugin": false
        }
      }),
      "utf8"
    );

    const plugins = readInstalledPlugins(claudePath, "enabledPlugins", "map");
    expect(plugins.map((p) => (typeof p === "string" ? p : p.name))).toEqual([
      "superpowers@claude-plugins-official"
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agents.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement `readInstalledPlugins` and update `DEFAULT_AGENTS` and `detectAgents`**

In `src/core/agents.ts`:
- Define `opencode.plugins` with `paths`, `key: "plugin"`, `format: "array"`, and `dirPaths`.
- Define `claude-code.plugins` with `paths`, `key: "enabledPlugins"`, and `format: "map"`.
- Implement `readInstalledPlugins`.
- Update `detectAgents` to populate `pluginsConfigPath` and `pluginsDirPath`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agents.test.ts`  
Expected: PASS.

---

### Task 3: Merger & File Installation (`src/core/merger.ts`)

**Files:**
- Modify: `src/core/merger.ts`
- Test: `tests/merger.test.ts`

- [ ] **Step 1: Write the failing tests for `mergePluginsIntoFile` and `installPluginFiles`**

Add to `tests/merger.test.ts`:
```ts
describe("plugin merging", () => {
  it("merges array plugins into JSONC file without duplicates", () => {
    const configPath = path.join(testDir, "test-opencode.jsonc");
    fs.writeFileSync(configPath, `{\n  // comment\n  "plugin": ["existing-plugin"]\n}`, "utf8");

    mergePluginsIntoFile(configPath, ["new-plugin@latest", "existing-plugin"], "plugin", "array");

    const content = fs.readFileSync(configPath, "utf8");
    expect(content).toContain("// comment");
    const parsed = JSON.parse(stripJsonComments(content));
    expect(parsed.plugin).toEqual(["existing-plugin", "new-plugin@latest"]);
  });

  it("merges map plugins into JSON file setting true", () => {
    const configPath = path.join(testDir, "test-claude.json");
    fs.writeFileSync(configPath, JSON.stringify({ enabledPlugins: { "old-plugin": true } }), "utf8");

    mergePluginsIntoFile(configPath, ["new-plugin@marketplace"], "enabledPlugins", "map");

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.enabledPlugins["old-plugin"]).toBe(true);
    expect(parsed.enabledPlugins["new-plugin@marketplace"]).toBe(true);
  });

  it("installPluginFiles writes plugin scripts and rejects path traversal", () => {
    const pluginDir = path.join(testDir, "plugins");
    installPluginFiles(pluginDir, "my-plugin", {
      "index.ts": "console.log('hi');"
    });

    expect(fs.existsSync(path.join(pluginDir, "my-plugin", "index.ts"))).toBe(true);

    expect(() => {
      installPluginFiles(pluginDir, "evil-plugin", {
        "../../bad.txt": "evil"
      });
    }).toThrow(/traversal/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/merger.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement `mergePluginsIntoFile` and `installPluginFiles`**

Implement `mergePluginsIntoFile` (handling JSONC comments and both array/map formats) and `installPluginFiles` with path validation.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/merger.test.ts`  
Expected: PASS.

---

### Task 4: CLI Commands Integration (`list`, `inspect`, `share`, `install`, `agent`)

**Files:**
- Modify: `src/commands/list.ts`
- Modify: `src/commands/inspect.ts`
- Modify: `src/commands/share.ts`
- Modify: `src/commands/install.ts`
- Modify: `src/commands/agent.ts`
- Modify: `src/cli.ts`
- Modify: `src/commands/instructions.ts`
- Test: `tests/commands.test.ts`
- Test: `tests/cli.test.ts`

- [ ] **Step 1: Write integration tests for CLI plugin flags and execution**

In `tests/commands.test.ts` and `tests/cli.test.ts`:
- Test `listCommand` prints plugins and returns them in `--json`.
- Test `inspectCommand` displays plugins from a manifest in text and `--json`.
- Test `shareCommand` includes selected plugins (`-p, --plugins`) in generated pack and `--json`.
- Test `installCommand` installs plugins into target agent config, respecting `--plugin-dir`.
- Test `agentAddCommand` prompts for and stores `plugins.paths` and `plugins.dirPaths`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/commands.test.ts tests/cli.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Wire up CLI commands and flags**
- Update `listCommand` with plugin scanning and `--json` reporting.
- Update `inspectCommand` with plugin summary.
- Update `shareCommand` with `-p, --plugins` using `collectDirectoryFilesAsync`.
- Update `installCommand` with `--plugin-dir` and plugin extraction.
- Update `agentAddCommand` with plugin path prompts.
- Register CLI flags in `src/cli.ts`.
- Update agent guide in `src/commands/instructions.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/commands.test.ts tests/cli.test.ts`  
Expected: PASS.

---

### Task 5: End-to-End Build & Real-World Agent Verification

**Files:**
- Build: `dist/cli.js`

- [ ] **Step 1: Build production CLI bundle**

Run: `bun run build`  
Expected: `Bundled ... dist/cli.js` with zero errors.

- [ ] **Step 2: Run complete test suite**

Run: `bun test`  
Expected: All tests pass across all test suites.

- [ ] **Step 3: Test live discovery against user's OpenCode & Claude Code configs**

Run: `node bin/smcp.js list -a opencode --json`  
Expected: OpenCode's plugins (`opencode-gemini-auth@latest`, `./plugin/antigravity.ts`, `./plugin/code-search.ts`) appear in the JSON output under `plugins`.

Run: `node bin/smcp.js list -a claude --json`  
Expected: Claude Code's enabled plugins (`superpowers@claude-plugins-official`, `ponytail@ponytail`, etc.) appear under `plugins`.

- [ ] **Step 4: Update installed `smcp` skill**

Run: `node bin/smcp.js agent install-skill`  
Expected: Reinstalls updated `smcp` skill into OpenCode and Claude Code.

---
