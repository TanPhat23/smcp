# Design Spec: Cross-CLI Agent & Workflow Sharing in smcp

**Date:** 2026-10-01  
**Status:** Approved for Implementation Planning  
**Target Version:** `smcp` v0.3.0  

---

## 1. Overview & Problem Statement

`smcp` enables AI developers and teams to package, inspect, install, update, and remove MCP servers, Agent Skills, and Plugins across multiple AI coding harnesses (OpenCode, Claude Code, Codex, Cursor, Windsurf).

Modern AI coding workflows increasingly rely on **specialized multi-agent roles** (e.g. planner, researcher, implementer, reviewer, security auditor). Currently, each AI harness implements subagents and role prompts with different formats, directory structures, and configuration files:

- **OpenCode:** Subagents live in `.opencode/agents/<name>.md` (or `~/.config/opencode/agents/<name>.md`) or under the `agent` key in `opencode.jsonc`. They support `mode: "subagent" | "primary"`, custom tool restrictions, model overrides, and temperature.
- **Codex:** Roles live in `.codex/agents/<name>.toml` (or `~/.codex/agents/<name>.toml`), providing role presets for `spawn_agent(agent_type: "<name>")`, with `reasoning_effort` and model tiers, backed by `~/.codex/config.toml` (`multi_agent = true`).
- **Claude Code:** Custom workflow commands live in `.claude/commands/<name>.md` (or `~/.claude/commands/<name>.md`), triggered as slash commands (e.g., `/reviewer`) or delegated via `CLAUDE.md` instructions.
- **Cursor:** Rules live in `.cursor/rules/<name>.mdc` with description and glob matching.

Without cross-CLI agent support in `smcp`, pack authors cannot distribute complete multi-agent workflows alongside the MCP tools and skills those agents require.

This specification defines **Universal Agent & Workflow Sharing** in `smcp`.

---

## 2. Universal Agent Specification

Pack authors define each agent as a Markdown file with YAML frontmatter located in an `agents/` directory (e.g., `agents/reviewer.md`).

### 2.1 Frontmatter Schema

```yaml
---
name: reviewer
description: Adversarial security and quality code reviewer
mode: subagent                # "subagent" | "primary" | "all" (default: "subagent")
model: claude-3-7-sonnet       # Recommended model tier or specifier (optional)
tools:
  allow: [read, grep, glob]   # Allowed tools
  deny: [edit, write, shell]  # Blocked tools
skills:                       # Referenced skill names to attach
  - code-review-and-quality
  - security-review

# Extensible platform-specific overrides:
codex:
  reasoning_effort: high      # "low" | "medium" | "high"
  fork_turns: none            # isolated context fork

opencode:
  model: anthropic/claude-3-7-sonnet
  permission:
    edit: deny
    shell: deny

claude:
  command: reviewer           # Slash command name in Claude Code
  argument_hint: "[diff|pr]"

cursor:
  alwaysApply: false
  globs: ["**/*"]
---
# Adversarial Code Reviewer

You are an adversarial code review specialist. Your job is to rigorously
critique code diffs, architecture decisions, and test coverage for correctness,
security vulnerabilities, and edge cases.
```

### 2.2 Core Properties

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | *(Required)* | Alphanumeric identifier (`^[a-zA-Z0-9_-]+$`). |
| `description` | `string` | *(Required)* | Summary of the agent's role; used by controllers to delegate. |
| `mode` | `enum` | `"subagent"` | `"subagent"`, `"primary"`, or `"all"`. |
| `model` | `string` | `undefined` | Recommended model (e.g., `claude-3-7-sonnet`). |
| `temperature` | `number` | `undefined` | LLM temperature preference. |
| `tools` | `object` or `string[]` | `undefined` | Tool allow/deny list or explicit allowed tools. |
| `skills` | `string[]` | `[]` | List of skill names required by this agent. |
| `codex` | `object` | `undefined` | Codex-specific options (`reasoning_effort`, `fork_turns`). |
| `opencode` | `object` | `undefined` | OpenCode-specific options (`permission`, `provider`). |
| `claude` | `object` | `undefined` | Claude-specific options (`command`, `argument_hint`). |
| `cursor` | `object` | `undefined` | Cursor-specific options (`alwaysApply`, `globs`). |

---

## 3. Architecture & Adapter Engine

A pluggable adapter engine (`packages/core/src/core/agents/compilers/`) converts Universal Agent definitions into the native formats required by target harnesses.

```
                          ┌───────────────────────────┐
                          │     agents/<name>.md      │
                          │ (Universal Agent Spec)    │
                          └─────────────┬─────────────┘
                                        │
                         smcp Agent Compilation Engine
                                        │
           ┌────────────────────┬───────┴────────────┬────────────────────┐
           ▼                    ▼                    ▼                    ▼
   [OpenCode Adapter]    [Codex Adapter]    [Claude Code Adapter]   [Cursor Adapter]
           │                    │                    │                    │
           ▼                    ▼                    ▼                    ▼
  .opencode/agents/     .codex/agents/       .claude/commands/     .cursor/rules/
      <name>.md            <name>.toml           <name>.md            <name>.mdc
```

### 3.1 OpenCode Adapter
- **Global Destination:** `~/.config/opencode/agents/<name>.md`
- **Project Destination:** `./.opencode/agents/<name>.md`
- **Format:** Native OpenCode Markdown agent with frontmatter.
- **Transformations:**
  - Emits `mode`, `description`, and `model`.
  - Merges `tools.allow` and `tools.deny` into OpenCode's `permission` structure if present.
  - Injects `opencode:` overrides directly into the frontmatter.

### 3.2 Codex Adapter
- **Global Destination:** `~/.codex/agents/<name>.toml`
- **Project Destination:** `./.codex/agents/<name>.toml`
- **Format:** TOML role file compatible with `spawn_agent(agent_type: "<name>")`.
- **Fields:**
  ```toml
  name = "reviewer"
  description = "Adversarial security and quality code reviewer"
  model = "claude-3-7-sonnet"
  reasoning_effort = "high"

  system_prompt = """
  # Adversarial Code Reviewer
  ...
  """
  ```
- **Codex Preflight Check:** Checks `config.toml` for `[features] multi_agent = true`. If not present, prompts or updates config so multi-agent spawns succeed.

### 3.3 Claude Code Adapter
- **Global Destination:** `~/.claude/commands/<name>.md`
- **Project Destination:** `./.claude/commands/<name>.md`
- **Format:** Custom slash command file invokable via `/<name>`.
- **Fields:**
  ```markdown
  ---
  description: Adversarial security and quality code reviewer
  argument-hint: "[diff|pr]"
  ---
  # Role: reviewer
  You are an adversarial code review specialist...

  Context & arguments: $ARGUMENTS
  ```
- **`CLAUDE.md` Registration:** Appends an `## Installed Agent Roles` entry to the target `CLAUDE.md` summarizing the role and prompt for subagent controller awareness.

### 3.4 Cursor Adapter
- **Destination:** `.cursor/rules/<name>.mdc`
- **Format:** Cursor Rule with frontmatter `alwaysApply: false` and the agent's description.

---

## 4. Manifest Schema & Packaging Lifecycle

### 4.1 Manifest (`smcp.json`)
The manifest schema is extended with an `agents` array:

```json
{
  "name": "fullstack-workflow",
  "version": "1.0.0",
  "mcpServers": {},
  "skills": [],
  "agents": [
    {
      "name": "reviewer",
      "path": "./agents/reviewer.md",
      "description": "Adversarial security and quality code reviewer"
    }
  ],
  "plugins": []
}
```

### 4.2 Packing (`smcp pack`)
1. Detects all `.md` files under `./agents/`.
2. Validates frontmatter using Zod (`AgentEntrySchema`).
3. Runs security and secret sanitization on agent prompts and frontmatter values.
4. Bundles `agents/` files into the pack distribution (archive, Gist, or repo).

### 4.3 Inspecting (`smcp inspect`)
Displays agent metadata alongside MCP servers, skills, and plugins:
```text
🤖 Agents (1):
  • reviewer (subagent) — Adversarial security and quality code reviewer
```

### 4.4 Installing (`smcp install`)
1. Resolves target agents from CLI flags (`-a opencode,claude,codex`).
2. Compiles Universal Agent definitions into the native formats using respective adapters.
3. Writes files adhering to `--global` (default) vs. `--project` scopes.
4. Records installed agents in `~/.smcp/installed.json` under `installedAgents: ["reviewer"]`.
5. Outputs written file paths in CLI and `--json` (`writtenPaths[agentId].agents`).

### 4.5 Updating & Uninstalling
- **`smcp update`:** Re-compiles agents from source when the pack version changes.
- **`smcp uninstall`:** Cleans up all generated `.md`, `.toml`, and `.mdc` files across all configured target agent directories.

---

## 5. Verification & Testing Strategy

1. **Schema Validation Tests:**
   - Validates frontmatter parsing for required keys (`name`, `description`).
   - Validates optional fields (`mode`, `tools`, `skills`, platform overrides).
2. **Adapter Unit Tests:**
   - `OpenCodeAdapter`: Verifies output markdown and permission mapping.
   - `CodexAdapter`: Verifies TOML serialization, `reasoning_effort`, and `system_prompt` preservation.
   - `ClaudeCodeAdapter`: Verifies slash command output and `argument-hint` injection.
   - `CursorAdapter`: Verifies `.mdc` frontmatter and body.
3. **Integration Lifecycle Tests:**
   - Full pack -> inspect -> install -> update -> uninstall roundtrip testing verifying filesystem states and `writtenPaths`.
4. **Scope Tests:**
   - Verifies `--global` writes to user home directories and `--project` writes to local workspace directories.
