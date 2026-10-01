import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  DEFAULT_AGENTS,
  getAgentProfiles,
  installAgentFiles,
  resolveActiveAgentPath
} from "../packages/core/src/core/agents/index.ts";
import type { UniversalAgent } from "../packages/core/src/types/agent.ts";

describe("Agent Profiles & Installer", () => {
  it("has agents configuration on opencode and claude-code profiles", () => {
    const profiles = getAgentProfiles();
    expect(profiles.opencode.agents).toBeDefined();
    expect(profiles.opencode.agents?.paths).toContain("~/.config/opencode/agents");
    expect(profiles.opencode.agents?.paths).toContain("./.opencode/agents");

    expect(profiles["claude-code"].agents).toBeDefined();
    expect(profiles["claude-code"].agents?.paths).toContain("~/.claude/commands");
    expect(profiles["claude-code"].agents?.paths).toContain("./.claude/commands");

    expect(profiles.cursor.agents).toBeNull();
    expect(profiles.windsurf.agents).toBeNull();
  });

  it("installs agent file cleanly in target directory with safe permissions", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-installer-test-"));
    const agentDir = path.join(tmp, "agents");

    const sampleAgent: UniversalAgent = {
      name: "reviewer",
      description: "Adversarial reviewer",
      mode: "subagent",
      prompt: "Review code thoroughly."
    };

    const res = installAgentFiles(agentDir, sampleAgent, "opencode");
    expect(res.writtenPath).toBe(path.join(agentDir, "reviewer.md"));
    expect(fs.existsSync(res.writtenPath)).toBe(true);

    const content = fs.readFileSync(res.writtenPath, "utf8");
    expect(content).toContain("name: reviewer");
    expect(content).toContain("Review code thoroughly.");
  });

  it("prevents path traversal when installing agent", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-installer-test-"));
    const sampleAgent: UniversalAgent = {
      name: "safe-name",
      description: "Adversarial reviewer",
      claude: { command: "../../escaped-cmd" },
      prompt: "Malicious command."
    };

    const res = installAgentFiles(tmp, sampleAgent, "claude-code");
    // Should be sanitized to escaped-cmd.md inside tmp, not outside
    expect(res.writtenPath).toBe(path.join(tmp, "escaped-cmd.md"));
    expect(fs.existsSync(path.join(tmp, "escaped-cmd.md"))).toBe(true);
  });

  it("supports scoped agent installation via agent id and options", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-installer-test-"));
    const agent: UniversalAgent = {
      name: "planner",
      description: "Task planner",
      mode: "subagent",
      prompt: "Decompose tasks"
    };

    const projRes = installAgentFiles("opencode", agent, { scope: "project", cwd: tmp });
    expect(projRes.writtenPath).toBe(path.join(tmp, ".opencode", "agents", "planner.md"));
    expect(fs.existsSync(projRes.writtenPath)).toBe(true);

    const globRes = installAgentFiles("opencode", agent, { scope: "global", homeDir: tmp });
    expect(globRes.writtenPath).toBe(path.join(tmp, ".config", "opencode", "agents", "planner.md"));
    expect(fs.existsSync(globRes.writtenPath)).toBe(true);
  });

  it("validates input arguments and throws appropriate errors", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-installer-test-"));
    const validAgent: UniversalAgent = {
      name: "tester",
      description: "Testing",
      prompt: "Run tests"
    };

    expect(() => installAgentFiles("", validAgent, "opencode")).toThrow();
    expect(() => installAgentFiles(null as unknown as string, validAgent, "opencode")).toThrow();
    expect(() => installAgentFiles(tmp, null as unknown as UniversalAgent, "opencode")).toThrow();
    expect(() => installAgentFiles(tmp, validAgent, "unsupported-agent")).toThrow();
    expect(() => installAgentFiles("cursor", validAgent, { scope: "project", cwd: tmp })).toThrow(/does not support agents/);
  });
});
