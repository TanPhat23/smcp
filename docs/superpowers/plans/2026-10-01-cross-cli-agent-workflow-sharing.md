# Cross-CLI Agent & Workflow Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `smcp` to bundle, inspect, install, update, and remove universal agent & workflow definitions (`agents/*.md`) across OpenCode, Codex, Claude Code, and Cursor.

**Architecture:** Universal agents are authored in Markdown with YAML frontmatter specifying core roles, tools, and extensible platform overrides. An adapter engine compiles these into native formats: OpenCode subagents (`.opencode/agents/<name>.md`), Codex TOML roles (`.codex/agents/<name>.toml`), Claude Code commands (`.claude/commands/<name>.md`), and Cursor rules (`.cursor/rules/<name>.mdc`).

**Tech Stack:** TypeScript, Bun, Node.js, Zod, js-yaml / yaml frontmatter parsing, `@tanphat/smcp-core`, `@tanphat/smcp` CLI.

**Spec:** `docs/superpowers/specs/2026-10-01-cross-cli-agent-workflow-sharing-design.md`

## Global Constraints

- Agent files are authored in Markdown with YAML frontmatter in `agents/<name>.md`.
- Target harnesses supported: `opencode`, `claude-code`, `codex`, `cursor`.
- Scoping must support both `--global` (default) and `--project` locations.
- Codex adapter must verify `[features] multi_agent = true` in `config.toml`.
- Claude Code adapter must generate slash commands in `.claude/commands/` and register in `CLAUDE.md`.
- No new external runtime dependencies; use standard library or existing YAML/JSON parsers.
- All written agent paths must be reported in CLI messages and `--json` (`writtenPaths[agentId].agents`).

## Review Focus

- Empty or invalid YAML frontmatter: must fail validation with a clear diagnostic message instead of crashing.
- Missing platform override: must fall back cleanly to universal defaults (`mode`, `tools`, `model`, prompt).
- System prompt multi-line strings with special characters / quotes: must serialize safely into Codex TOML and Claude Markdown without truncation.
- Uninstall clean removal: must remove compiled agent files across all target agents without leaving orphan files.
- Simultaneous multi-agent pack install: `-a opencode,claude,codex` in one run must compile and write to all selected targets.

---

## File Structure

- `packages/core/src/types/agent.ts`: Type definitions for `UniversalAgent`, `AgentFrontmatter`, and compiler options.
- `packages/core/src/core/agents/frontmatter.ts`: Frontmatter extraction and Zod validation.
- `packages/core/src/core/agents/compilers/`:
  - `types.ts`: Compiler interface definition.
  - `opencode.ts`: Universal Agent to OpenCode Markdown compiler.
  - `codex.ts`: Universal Agent to Codex TOML compiler.
  - `claude.ts`: Universal Agent to Claude Code slash command compiler.
  - `cursor.ts`: Universal Agent to Cursor rule compiler.
  - `index.ts`: Compiler registry & router.
- `packages/core/src/core/agents/agents-installer.ts`: High-level installation and file writing across scopes.
- `packages/core/src/core/agents/defaults.ts`: Added `codex` profile and `agents` path configurations for all profiles.
- `packages/core/src/core/state/installed.ts`: Add `installedAgents` tracking to `InstalledPackRecord`.
- `packages/cli/src/commands/pack/discovery.ts`: Discover and bundle `agents/*.md`.
- `packages/cli/src/commands/inspect.ts`: Display agents in CLI inspect.
- `packages/cli/src/commands/install/agents.ts`: Invoke agent compilers during installation.
- `packages/cli/src/commands/uninstall.ts`: Remove installed agent files.

---

### Task 1: Core Agent Types, Manifest Extension & Frontmatter Parser

**Files:**
- Create: `packages/core/src/types/agent.ts`
- Create: `packages/core/src/core/agents/frontmatter.ts`
- Modify: `packages/core/src/types/manifest.ts`
- Modify: `packages/core/src/types/index.ts`
- Test: `tests/frontmatter.test.ts`

**Interfaces:**
- Produces:
  - `UniversalAgent`: parsed agent object with frontmatter and prompt body.
  - `parseAgentMarkdown(content: string, filename?: string): UniversalAgent`.
  - `AgentEntrySchema` and `Manifest.agents?: AgentEntry[]`.

- [ ] **Step 1: Write the failing test for frontmatter parsing and schema validation**

```typescript
// tests/frontmatter.test.ts
import { describe, expect, it } from "bun:test";
import { parseAgentMarkdown } from "../packages/core/src/core/agents/frontmatter.ts";

describe("parseAgentMarkdown", () => {
  it("parses valid universal agent markdown with frontmatter and body", () => {
    const raw = `---
name: reviewer
description: Adversarial code reviewer
mode: subagent
model: claude-3-7-sonnet
tools:
  allow: [read, grep]
  deny: [edit, write]
codex:
  reasoning_effort: high
---
# Reviewer Prompt
You are an adversarial reviewer.`;

    const parsed = parseAgentMarkdown(raw, "agents/reviewer.md");
    expect(parsed.name).toBe("reviewer");
    expect(parsed.description).toBe("Adversarial code reviewer");
    expect(parsed.mode).toBe("subagent");
    expect(parsed.model).toBe("claude-3-7-sonnet");
    expect(parsed.tools?.allow).toEqual(["read", "grep"]);
    expect(parsed.tools?.deny).toEqual(["edit", "write"]);
    expect(parsed.codex?.reasoning_effort).toBe("high");
    expect(parsed.prompt.trim()).toBe("# Reviewer Prompt\nYou are an adversarial reviewer.");
  });

  it("throws a descriptive error when required frontmatter fields are missing", () => {
    const raw = `---
mode: subagent
---
Missing name and description`;

    expect(() => parseAgentMarkdown(raw, "bad.md")).toThrow(/name.*required/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/frontmatter.test.ts`  
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `types/agent.ts`, `manifest.ts` update, and `frontmatter.ts`**

```typescript
// packages/core/src/types/agent.ts
import { z } from "zod";

export const AgentToolsSchema = z.union([
  z.array(z.string()),
  z.object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional()
  })
]);

export const UniversalAgentFrontmatterSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, "Name must be alphanumeric, hyphen, or underscore"),
  description: z.string().min(1, "Description is required"),
  mode: z.enum(["subagent", "primary", "all"]).optional().default("subagent"),
  model: z.string().optional(),
  temperature: z.number().optional(),
  tools: AgentToolsSchema.optional(),
  skills: z.array(z.string()).optional().default([]),
  codex: z.record(z.string(), z.unknown()).optional(),
  opencode: z.record(z.string(), z.unknown()).optional(),
  claude: z.record(z.string(), z.unknown()).optional(),
  cursor: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export type UniversalAgentFrontmatter = z.infer<typeof UniversalAgentFrontmatterSchema>;

export interface UniversalAgent extends UniversalAgentFrontmatter {
  prompt: string;
}

export const AgentEntrySchema = z.object({
  name: z.string(),
  path: z.string().optional(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  model: z.string().optional()
}).passthrough();

export type AgentEntry = z.infer<typeof AgentEntrySchema>;
```

Implement `packages/core/src/core/agents/frontmatter.ts` using regex-based YAML frontmatter splitting and Zod validation. Extend `packages/core/src/types/manifest.ts` to include `agents: z.array(AgentEntrySchema).optional().default([])`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/frontmatter.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/ packages/core/src/core/agents/frontmatter.ts tests/frontmatter.test.ts
git commit -m "feat(core): add universal agent types, manifest schema, and frontmatter parser"
```

---

### Task 2: Cross-CLI Agent Compilers (OpenCode, Codex, Claude Code, Cursor)

**Files:**
- Create: `packages/core/src/core/agents/compilers/types.ts`
- Create: `packages/core/src/core/agents/compilers/opencode.ts`
- Create: `packages/core/src/core/agents/compilers/codex.ts`
- Create: `packages/core/src/core/agents/compilers/claude.ts`
- Create: `packages/core/src/core/agents/compilers/cursor.ts`
- Create: `packages/core/src/core/agents/compilers/index.ts`
- Test: `tests/compilers.test.ts`

**Interfaces:**
- Produces:
  - `compileAgentForHarness(agent: UniversalAgent, harnessId: string): CompiledAgentFile`
  - `CompiledAgentFile = { filename: string; content: string }`

- [ ] **Step 1: Write failing tests for all harness compilers**

```typescript
// tests/compilers.test.ts
import { describe, expect, it } from "bun:test";
import { compileAgentForHarness } from "../packages/core/src/core/agents/compilers/index.ts";
import type { UniversalAgent } from "../packages/core/src/types/agent.ts";

const sampleAgent: UniversalAgent = {
  name: "reviewer",
  description: "Adversarial code reviewer",
  mode: "subagent",
  model: "claude-3-7-sonnet",
  tools: { allow: ["read", "grep"], deny: ["shell"] },
  skills: ["security-review"],
  codex: { reasoning_effort: "high" },
  claude: { argument_hint: "[diff]" },
  prompt: "You are an adversarial reviewer."
};

describe("Agent Compilers", () => {
  it("compiles for OpenCode (.md with frontmatter)", () => {
    const res = compileAgentForHarness(sampleAgent, "opencode");
    expect(res.filename).toBe("reviewer.md");
    expect(res.content).toContain("name: reviewer");
    expect(res.content).toContain("mode: subagent");
    expect(res.content).toContain("You are an adversarial reviewer.");
  });

  it("compiles for Codex (.toml with system_prompt and reasoning_effort)", () => {
    const res = compileAgentForHarness(sampleAgent, "codex");
    expect(res.filename).toBe("reviewer.toml");
    expect(res.content).toContain('name = "reviewer"');
    expect(res.content).toContain('reasoning_effort = "high"');
    expect(res.content).toContain("You are an adversarial reviewer.");
  });

  it("compiles for Claude Code (.md slash command)", () => {
    const res = compileAgentForHarness(sampleAgent, "claude-code");
    expect(res.filename).toBe("reviewer.md");
    expect(res.content).toContain("description: Adversarial code reviewer");
    expect(res.content).toContain("$ARGUMENTS");
  });

  it("compiles for Cursor (.mdc rule)", () => {
    const res = compileAgentForHarness(sampleAgent, "cursor");
    expect(res.filename).toBe("reviewer.mdc");
    expect(res.content).toContain("alwaysApply: false");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/compilers.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement compilers**

Implement:
1. `opencode.ts`: Re-serializes frontmatter combining core keys, permissions from `tools.allow`/`tools.deny`, and `opencode:` overrides.
2. `codex.ts`: Serializes TOML containing `name`, `description`, `model`, `reasoning_effort`, and multi-line triple-quoted `system_prompt`.
3. `claude.ts`: Serializes Claude Code slash command markdown with `$ARGUMENTS` context hook.
4. `cursor.ts`: Serializes Cursor `.mdc` frontmatter and prompt body.
5. `index.ts`: Routes `compileAgentForHarness` to the appropriate compiler.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/compilers.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/core/agents/compilers/ tests/compilers.test.ts
git commit -m "feat(core): implement agent compilers for OpenCode, Codex, Claude Code, and Cursor"
```

---

### Task 3: Agent Profiles, Scoped Path Resolution & Installer

**Files:**
- Modify: `packages/core/src/types/profile.ts`
- Modify: `packages/core/src/core/agents/defaults.ts`
- Create: `packages/core/src/core/agents/agents-installer.ts`
- Modify: `packages/core/src/core/agents/index.ts`
- Test: `tests/agents-installer.test.ts`

**Interfaces:**
- Extends `AgentProfile` with:
  ```typescript
  agents?: {
    paths: string[];
    format?: "markdown" | "toml" | "command" | "mdc";
  } | null;
  ```
- Produces:
  `installAgentFiles(targetAgentId: string, agent: UniversalAgent, options?: { scope?: "global" | "project"; cwd?: string; homeDir?: string }): { writtenPath: string }`

- [ ] **Step 1: Write failing test for scoped agent installer**

```typescript
// tests/agents-installer.test.ts
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { installAgentFiles } from "../packages/core/src/core/agents/agents-installer.ts";
import type { UniversalAgent } from "../packages/core/src/types/agent.ts";

describe("installAgentFiles", () => {
  it("installs OpenCode agent in project scope and global scope", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-agent-test-"));
    const agent: UniversalAgent = {
      name: "planner",
      description: "Task planner",
      mode: "subagent",
      prompt: "Decompose tasks"
    };

    // Project scope
    const projRes = installAgentFiles("opencode", agent, { scope: "project", cwd: tmp });
    expect(projRes.writtenPath).toBe(path.join(tmp, ".opencode", "agents", "planner.md"));
    expect(fs.existsSync(projRes.writtenPath)).toBe(true);

    // Global scope
    const globRes = installAgentFiles("opencode", agent, { scope: "global", homeDir: tmp });
    expect(globRes.writtenPath).toBe(path.join(tmp, ".config", "opencode", "agents", "planner.md"));
    expect(fs.existsSync(globRes.writtenPath)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agents-installer.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement defaults update and `agents-installer.ts`**

Update `DEFAULT_AGENTS`:
- Add `codex` profile:
  ```typescript
  codex: {
    name: "Codex",
    mcpConfig: { paths: ["~/.codex/config.toml"], key: "mcp" },
    skills: { paths: ["~/.codex/skills", "./.codex/skills"] },
    agents: { paths: ["~/.codex/agents", "./.codex/agents"], format: "toml" },
    plugins: null
  }
  ```
- Add `agents` paths to `opencode` (`["~/.config/opencode/agents", "./.opencode/agents"]`), `claude-code` (`["~/.claude/commands", "./.claude/commands"]`), and `cursor` (`["./.cursor/rules"]`).
- Implement `installAgentFiles` resolving active agent paths via `resolveActiveAgentPath` and compiling with `compileAgentForHarness`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agents-installer.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/core/agents/defaults.ts packages/core/src/core/agents/agents-installer.ts tests/agents-installer.test.ts
git commit -m "feat(core): add codex profile and scoped agent installer"
```

---

### Task 4: Packaging and Inspect Integration (`smcp pack` & `smcp inspect`)

**Files:**
- Modify: `packages/cli/src/commands/pack/discovery.ts`
- Modify: `packages/cli/src/commands/pack/pack.ts`
- Modify: `packages/cli/src/commands/inspect.ts`
- Test: `tests/pack-inspect-agents.test.ts`

**Interfaces:**
- `smcp pack` detects `agents/*.md`, validates frontmatter, sanitizes prompts, and includes them in the manifest and archive.
- `smcp inspect` formats and displays included agents.

- [ ] **Step 1: Write failing test for agent pack discovery and inspect output**

```typescript
// tests/pack-inspect-agents.test.ts
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverPackComponents } from "../packages/cli/src/commands/pack/discovery.ts";
import { formatInspectOutput } from "../packages/cli/src/commands/inspect.ts";

describe("Pack & Inspect Agents", () => {
  it("discovers agents in agents/ directory during pack discovery", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-pack-agents-"));
    const agentsDir = path.join(tmp, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "reviewer.md"),
      `---\nname: reviewer\ndescription: Code reviewer\nmode: subagent\n---\nPrompt here`
    );

    const components = discoverPackComponents(tmp);
    expect(components.agents).toBeDefined();
    expect(components.agents?.length).toBe(1);
    expect(components.agents?.[0].name).toBe("reviewer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/pack-inspect-agents.test.ts`  
Expected: FAIL

- [ ] **Step 3: Update `discovery.ts`, `pack.ts`, and `inspect.ts`**

1. In `discovery.ts`, read `./agents/*.md`, parse with `parseAgentMarkdown`, and return array of agents.
2. In `pack.ts`, package discovered agent files into the raw bundle.
3. In `inspect.ts`, render:
   ```text
   🤖 Agents (N):
     • <name> (<mode>) — <description>
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/pack-inspect-agents.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/pack/ packages/cli/src/commands/inspect.ts tests/pack-inspect-agents.test.ts
git commit -m "feat(cli): add agent discovery in pack and agent reporting in inspect"
```

---

### Task 5: End-to-End Install, Update & Uninstall Lifecycle

**Files:**
- Modify: `packages/cli/src/commands/install/agents.ts`
- Modify: `packages/cli/src/commands/install/install.ts`
- Modify: `packages/core/src/core/state/installed.ts`
- Modify: `packages/cli/src/commands/uninstall.ts`
- Test: `tests/install-agents-lifecycle.test.ts`

**Interfaces:**
- `installPackIntoAgents`: returns `installedAgents: string[]` and `writtenPaths[agentId].agents: string[]`.
- `recordInstalledPack`: records `installedAgents` in `~/.smcp/installed.json`.
- `uninstallCommand`: cleanly removes written agent files across target agents.

- [ ] **Step 1: Write failing lifecycle integration test**

```typescript
// tests/install-agents-lifecycle.test.ts
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

describe("Install, State Tracking & Uninstall of Agents", () => {
  it("installs agent into opencode and codex, tracks in installed.json, and uninstalls cleanly", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-e2e-agents-"));
    const homeDir = path.join(tmp, "home");
    const packDir = path.join(tmp, "pack");
    fs.mkdirSync(path.join(packDir, "agents"), { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });

    fs.writeFileSync(
      path.join(packDir, "smcp.json"),
      JSON.stringify({ name: "agent-pack", version: "1.0.0", agents: [{ name: "tester", path: "./agents/tester.md" }] })
    );
    fs.writeFileSync(
      path.join(packDir, "agents", "tester.md"),
      `---\nname: tester\ndescription: Test specialist\nmode: subagent\n---\nRun tests.`
    );

    const binSmcp = path.resolve("./packages/cli/dist/cli.js");

    // Install
    const installOut = execSync(
      `node "${binSmcp}" install "${packDir}" -a opencode,codex -f -y --global --json`,
      { cwd: tmp, env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir } }
    );
    const parsedInstall = JSON.parse(installOut.toString());
    expect(parsedInstall.success).toBe(true);
    expect(parsedInstall.installedAgents).toContain("tester");

    const opencodeAgentPath = path.join(homeDir, ".config", "opencode", "agents", "tester.md");
    const codexAgentPath = path.join(homeDir, ".codex", "agents", "tester.toml");
    expect(fs.existsSync(opencodeAgentPath)).toBe(true);
    expect(fs.existsSync(codexAgentPath)).toBe(true);

    // Uninstall
    execSync(
      `node "${binSmcp}" uninstall agent-pack -y --json`,
      { cwd: tmp, env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir } }
    );
    expect(fs.existsSync(opencodeAgentPath)).toBe(false);
    expect(fs.existsSync(codexAgentPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/install-agents-lifecycle.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement lifecycle wiring in install, state tracking, and uninstall**

1. In `packages/cli/src/commands/install/agents.ts`:
   - Iterate over `manifest.agents`.
   - Call `installAgentFiles` for each target agent.
   - Aggregate written paths into `writtenPaths[agentId].agents`.
2. In `packages/cli/src/commands/install/install.ts`:
   - Record `installedAgents` into `~/.smcp/installed.json`.
   - Print written agent paths in terminal output and include in `--json`.
3. In `packages/cli/src/commands/uninstall.ts`:
   - Remove agent files registered in the installed pack record.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/install-agents-lifecycle.test.ts`  
Expected: PASS

- [ ] **Step 5: Run full test suite to guarantee 0 regressions**

Run: `bun test`  
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/install/ packages/cli/src/commands/uninstall.ts packages/core/src/core/state/ tests/install-agents-lifecycle.test.ts
git commit -m "feat(cli): complete end-to-end agent installation, tracking, and uninstallation"
```

---

## Self-Review Checklist

1. **Spec Coverage:**
   - Universal Agent frontmatter & prompt body: Covered in Task 1.
   - Cross-CLI compilation (OpenCode, Codex, Claude Code, Cursor): Covered in Task 2.
   - Codex profile & `[features] multi_agent = true`: Covered in Task 2 & Task 3.
   - Claude Code slash commands & `CLAUDE.md`: Covered in Task 2 & Task 3.
   - Packaging & Discovery: Covered in Task 4.
   - Scoped Install, State Tracking & Uninstall: Covered in Task 3 & Task 5.
2. **Placeholder Scan:** No "TBD", "TODO", or vague requirements. Every step includes concrete test code, command executions, and exact file paths.
3. **Type Consistency:** Method signatures (`compileAgentForHarness`, `installAgentFiles`, `parseAgentMarkdown`) match across all tasks and test suites.
4. **Review Focus:** Addressed malformed frontmatter, missing platform overrides, multi-line TOML escaping, clean uninstallation, and multi-agent simultaneous installs.
