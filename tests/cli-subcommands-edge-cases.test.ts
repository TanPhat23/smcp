import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  agentInstallSkillCommand,
  agentListCommand
} from "../packages/cli/src/commands/agent/index.ts";
import { instructionsCommand } from "../packages/cli/src/commands/instructions.ts";
import {
  getAgentProfiles,
  registerAgentProfile,
  resetAgentProfiles,
  saveCustomAgent,
  scanSkills
} from "../packages/core/src/core/agents/index.ts";

describe("CLI Agent Subcommands & Instructions Deep Edge Cases", () => {
  let tmpDir: string;
  let originalCustomAgentsPath: string | undefined;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      "smcp-cli-subcmds-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(tmpDir, { recursive: true });

    originalCustomAgentsPath = process.env.SMCP_CUSTOM_AGENTS_PATH;
    process.env.SMCP_CUSTOM_AGENTS_PATH = path.join(tmpDir, "custom-agents.json");
    resetAgentProfiles();
  });

  afterEach(() => {
    resetAgentProfiles();
    if (originalCustomAgentsPath !== undefined) {
      process.env.SMCP_CUSTOM_AGENTS_PATH = originalCustomAgentsPath;
    } else {
      delete process.env.SMCP_CUSTOM_AGENTS_PATH;
    }

    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("agentInstallSkillCommand installs smcp skill into detected agents with skills directory", () => {
    const mockSkillsDir = path.join(tmpDir, "mock-agent-skills");
    fs.mkdirSync(mockSkillsDir, { recursive: true });

    const profiles = {
      "test-receiver": {
        name: "Test Receiver Agent",
        skills: {
          paths: [mockSkillsDir]
        }
      }
    };

    let stdoutJson = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      stdoutJson = msg;
    };

    try {
      agentInstallSkillCommand({ json: true, profiles });
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(stdoutJson);
    expect(parsed.success).toBe(true);
    expect(parsed.installedTo).toContain("Test Receiver Agent");

    // Verify SKILL.md was installed on disk
    const installedSkill = path.join(mockSkillsDir, "smcp", "SKILL.md");
    expect(fs.existsSync(installedSkill)).toBe(true);
    const content = fs.readFileSync(installedSkill, "utf8");
    expect(content).toContain("smcp — Agent Skills, MCP & Plugins Package Manager");
  });

  it("agentInstallSkillCommand handles zero detected agents gracefully in JSON mode", () => {
    let stdoutJson = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      stdoutJson = msg;
    };

    try {
      agentInstallSkillCommand({ json: true, profiles: {} });
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(stdoutJson);
    expect(parsed.success).toBe(false);
    expect(parsed.installedTo).toEqual([]);
  });

  it("agentListCommand outputs JSON with all registered agent profiles", () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    try {
      agentListCommand({ json: true });
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(output);
    expect(typeof parsed).toBe("object");
    expect(parsed.opencode).toBeDefined();
    expect(parsed["claude-code"]).toBeDefined();
    expect(parsed.cursor).toBeDefined();
  });

  it("instructionsCommand prints documentation without crashing", () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output += msg + "\n";
    };

    try {
      instructionsCommand();
    } finally {
      console.log = originalLog;
    }

    expect(output).toContain("smcp — Agent Skills, MCP & Plugins Package Manager");
    expect(output).toContain("Common Commands");
  });

  it("saveCustomAgent rejects invalid or malformed profile definitions", () => {
    expect(() => saveCustomAgent("", { name: "empty-id" })).toThrow();
    expect(() => saveCustomAgent("__proto__", { name: "evil" })).toThrow(/Invalid agent ID/);
    expect(() => saveCustomAgent("valid-id", { name: "" })).toThrow();
  });
});
