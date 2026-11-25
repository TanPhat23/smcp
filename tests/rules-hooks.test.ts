import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPackIntoAgents } from "../packages/cli/src/commands/install/index.ts";
import {
  readInstalledHooks,
  scanRules
} from "../packages/core/src/core/agents/index.ts";
import {
  installRuleFile,
  mergeHooksIntoFile,
  uninstallPackFromAgents
} from "../packages/core/src/core/merger/index.ts";
import type { AgentProfile, InstalledPackRecord, Manifest } from "../packages/core/src/types/index.ts";

function buildCrossAgentProfiles(rootDir: string): Record<string, AgentProfile> {
  return {
    "claude-code": {
      name: "Claude Code",
      mcpConfig: { paths: [path.join(rootDir, ".mcp.json")], key: "mcpServers" },
      plugins: {
        paths: [path.join(rootDir, ".claude", "settings.json")],
        key: "enabledPlugins",
        format: "map"
      },
      rules: {
        paths: [
          path.join(rootDir, "CLAUDE.md"),
          path.join(rootDir, ".claude", "rules")
        ]
      },
      hooks: {
        paths: [path.join(rootDir, ".claude", "settings.json")],
        key: "hooks"
      }
    },
    opencode: {
      name: "OpenCode",
      mcpConfig: { paths: [path.join(rootDir, "opencode.json")], key: "mcp" },
      rules: {
        paths: [path.join(rootDir, "AGENTS.md")]
      },
      hooks: null
    },
    cursor: {
      name: "Cursor",
      mcpConfig: { paths: [path.join(rootDir, ".cursor", "mcp.json")], key: "mcpServers" },
      rules: {
        paths: [
          path.join(rootDir, ".cursor", "rules"),
          path.join(rootDir, ".cursorrules"),
          path.join(rootDir, "AGENTS.md")
        ]
      },
      hooks: null
    },
    windsurf: {
      name: "Windsurf",
      mcpConfig: { paths: [path.join(rootDir, "windsurf-mcp.json")], key: "mcpServers" },
      rules: {
        paths: [
          path.join(rootDir, ".windsurfrules"),
          path.join(rootDir, ".windsurf", "rules")
        ]
      },
      hooks: null
    },
    agy: {
      name: "Antigravity",
      mcpConfig: { paths: [path.join(rootDir, ".agents", "mcp.json")], key: "mcpServers" },
      rules: {
        paths: [
          path.join(rootDir, "GEMINI.md"),
          path.join(rootDir, ".agents", "rules")
        ]
      },
      hooks: {
        paths: [path.join(rootDir, ".agents", "hooks.json")]
      }
    }
  };
}

describe("Cross-agent Rules and Hooks", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-rules-hooks-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scans .md, .mdc, .cursorrules, and .windsurfrules uniformly", () => {
    fs.mkdirSync(path.join(tmpDir, ".claude", "rules"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".cursor", "rules"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".windsurf", "rules"), { recursive: true });

    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Claude Project Rules\n");
    fs.writeFileSync(path.join(tmpDir, ".claude", "rules", "security.md"), "# Security\n");
    fs.writeFileSync(path.join(tmpDir, ".cursorrules"), "Use strict TypeScript\n");
    fs.writeFileSync(path.join(tmpDir, ".cursor", "rules", "style.mdc"), "---\ndescription: Style\n---\n");
    fs.writeFileSync(path.join(tmpDir, ".windsurfrules"), "Prefer functional style\n");
    fs.writeFileSync(path.join(tmpDir, ".windsurf", "rules", "tests.md"), "# Tests\n");

    const scanned = scanRules([
      path.join(tmpDir, "CLAUDE.md"),
      path.join(tmpDir, ".claude", "rules"),
      path.join(tmpDir, ".cursorrules"),
      path.join(tmpDir, ".cursor", "rules"),
      path.join(tmpDir, ".windsurfrules"),
      path.join(tmpDir, ".windsurf", "rules")
    ]);

    expect(scanned.map((r) => r.name)).toEqual([
      "CLAUDE",
      "security",
      "cursorrules",
      "style",
      "windsurfrules",
      "tests"
    ]);
  });

  it("installs and uninstalls rules across Claude Code, Cursor, Windsurf, OpenCode, and agy", () => {
    const profiles = buildCrossAgentProfiles(tmpDir);
    const manifest: Manifest = {
      name: "team-rules-pack",
      version: "1.0.0",
      rules: [
        { name: "CLAUDE", path: "rules/CLAUDE.md", content: "# Claude Instructions\n" },
        { name: "cursorrules", path: "rules/.cursorrules", content: "No any types\n" },
        { name: "windsurfrules", path: "rules/.windsurfrules", content: "Keep functions small\n" },
        { name: "AGENTS", path: "rules/AGENTS.md", content: "# Shared Agents\n" },
        { name: "GEMINI", path: "rules/GEMINI.md", content: "# Gemini Project\n" },
        { name: "typescript.mdc", path: "rules/typescript.mdc", content: "---\nalwaysApply: true\n---\n" },
        { name: "custom-rule", path: "rules/custom-rule.md", content: "# Custom Rule\n" }
      ]
    };

    const result = installPackIntoAgents(
      manifest,
      ["claude-code", "cursor", "windsurf", "opencode", "agy"],
      {},
      undefined,
      undefined,
      profiles,
      undefined,
      undefined,
      "project"
    );

    expect(result.installedRules).toEqual([
      "CLAUDE",
      "cursorrules",
      "windsurfrules",
      "AGENTS",
      "GEMINI",
      "typescript.mdc",
      "custom-rule"
    ]);

    // Claude Code writes CLAUDE.md plus modular rules under .claude/rules
    expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf8")).toBe("# Claude Instructions\n");
    expect(fs.existsSync(path.join(tmpDir, ".claude", "rules", "custom-rule.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".claude", "rules", "typescript.mdc"))).toBe(true);

    // Cursor preserves .cursorrules, AGENTS.md, and .cursor/rules/typescript.mdc
    expect(fs.readFileSync(path.join(tmpDir, ".cursorrules"), "utf8")).toBe("No any types\n");
    expect(fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf8")).toBe("# Shared Agents\n");
    expect(fs.existsSync(path.join(tmpDir, ".cursor", "rules", "typescript.mdc"))).toBe(true);

    // Windsurf writes .windsurfrules and modular .windsurf/rules/custom-rule.md
    expect(fs.readFileSync(path.join(tmpDir, ".windsurfrules"), "utf8")).toBe("Keep functions small\n");
    expect(fs.existsSync(path.join(tmpDir, ".windsurf", "rules", "custom-rule.md"))).toBe(true);

    // OpenCode only has explicit AGENTS.md configured, so non-matching rules land in sibling rules/
    expect(fs.existsSync(path.join(tmpDir, "rules", "custom-rule.md"))).toBe(true);

    // Antigravity writes GEMINI.md and .agents/rules/custom-rule.md
    expect(fs.readFileSync(path.join(tmpDir, "GEMINI.md"), "utf8")).toBe("# Gemini Project\n");
    expect(fs.existsSync(path.join(tmpDir, ".agents", "rules", "custom-rule.md"))).toBe(true);

    const record: InstalledPackRecord = {
      name: manifest.name,
      version: manifest.version,
      source: "local",
      installedAt: new Date().toISOString(),
      targetAgents: ["claude-code", "cursor", "windsurf", "opencode", "agy"],
      installedMcp: [],
      installedSkills: [],
      installedPlugins: [],
      installedAgents: [],
      installedRules: result.installedRules,
      installedHooks: []
    };

    const removed = uninstallPackFromAgents(record, profiles);
    expect(removed.removedRules).toContain("CLAUDE");
    expect(removed.removedRules).toContain("cursorrules");
    expect(removed.removedRules).toContain("windsurfrules");
    expect(removed.removedRules).toContain("AGENTS");
    expect(removed.removedRules).toContain("GEMINI");
    expect(removed.removedRules).toContain("typescript.mdc");
    expect(removed.removedRules).toContain("custom-rule");

    expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".cursorrules"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".windsurfrules"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "GEMINI.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".claude", "rules", "custom-rule.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".cursor", "rules", "typescript.mdc"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".windsurf", "rules", "custom-rule.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "rules", "custom-rule.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".agents", "rules", "custom-rule.md"))).toBe(false);
  });

  it("merges, reads, and uninstalls hooks for Claude Code settings.json and agy hooks.json without clobbering existing keys", () => {
    const profiles = buildCrossAgentProfiles(tmpDir);
    const claudeSettingsPath = path.join(tmpDir, ".claude", "settings.json");
    const agyHooksPath = path.join(tmpDir, ".agents", "hooks.json");

    fs.mkdirSync(path.dirname(claudeSettingsPath), { recursive: true });
    fs.writeFileSync(
      claudeSettingsPath,
      JSON.stringify(
        {
          model: "sonnet",
          enabledPlugins: { "existing-plugin": true },
          hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] }
        },
        null,
        2
      )
    );

    const manifest: Manifest = {
      name: "hooked-pack",
      version: "1.0.0",
      hooks: {
        PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "bun run lint" }] }],
        Stop: [{ hooks: [{ type: "command", command: "echo done" }] }]
      }
    };

    const result = installPackIntoAgents(
      manifest,
      ["claude-code", "agy"],
      {},
      undefined,
      undefined,
      profiles,
      undefined,
      undefined,
      "project"
    );

    expect(result.installedHooks).toEqual(["PostToolUse", "Stop"]);

    // Claude Code preserves model, enabledPlugins, and existing PreToolUse hook inside settings.json.hooks
    const claudeRaw: unknown = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf8"));
    expect(claudeRaw).toMatchObject({
      model: "sonnet",
      enabledPlugins: { "existing-plugin": true }
    });
    expect(readInstalledHooks(claudeSettingsPath, "hooks")).toEqual({
      PreToolUse: [{ matcher: "Bash", hooks: [] }],
      PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "bun run lint" }] }],
      Stop: [{ hooks: [{ type: "command", command: "echo done" }] }]
    });

    // Antigravity stores hooks at root of hooks.json
    expect(readInstalledHooks(agyHooksPath)).toEqual({
      PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "bun run lint" }] }],
      Stop: [{ hooks: [{ type: "command", command: "echo done" }] }]
    });

    const record: InstalledPackRecord = {
      name: manifest.name,
      version: manifest.version,
      source: "local",
      installedAt: new Date().toISOString(),
      targetAgents: ["claude-code", "agy"],
      installedMcp: [],
      installedSkills: [],
      installedPlugins: [],
      installedAgents: [],
      installedRules: [],
      installedHooks: result.installedHooks
    };

    const removed = uninstallPackFromAgents(record, profiles);
    expect(removed.removedHooks).toEqual(["PostToolUse", "Stop"]);

    // Existing Claude settings & PreToolUse remain intact while pack hooks are gone
    const afterClaude: unknown = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf8"));
    expect(afterClaude).toMatchObject({
      model: "sonnet",
      enabledPlugins: { "existing-plugin": true }
    });
    expect(readInstalledHooks(claudeSettingsPath, "hooks")).toEqual({
      PreToolUse: [{ matcher: "Bash", hooks: [] }]
    });
    expect(readInstalledHooks(agyHooksPath)).toEqual({});
  });

  it("installRuleFile rejects traversal and mergeHooksIntoFile ignores unsafe hook keys", () => {
    expect(() => installRuleFile(tmpDir, "../escape", "bad")).toThrow();

    const hooksFile = path.join(tmpDir, "hooks.json");
    const merged = mergeHooksIntoFile(
      hooksFile,
      {
        PreToolUse: [{ matcher: "Edit" }],
        __proto__: [{ evil: true }]
      },
      undefined
    );
    expect(merged).toEqual(["PreToolUse"]);
  });
});
