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
  claude: { argument_hint: "[diff]" },
  prompt: "You are an adversarial reviewer."
};

describe("Agent Compilers (Minimal: OpenCode & Claude Code)", () => {
  it("compiles for OpenCode (.md with frontmatter)", () => {
    const res = compileAgentForHarness(sampleAgent, "opencode");
    expect(res.filename).toBe("reviewer.md");
    expect(res.content).toContain("name: reviewer");
    expect(res.content).toContain("mode: subagent");
    expect(res.content).toContain("You are an adversarial reviewer.");
  });

  it("compiles for Claude Code as a subagent (name/description/tools/model, no slash-command artifacts)", () => {
    const res = compileAgentForHarness(
      { ...sampleAgent, model: "sonnet", tools: ["Read", "Grep"] },
      "claude-code"
    );
    expect(res.filename).toBe("reviewer.md");
    expect(res.content).toContain("name: reviewer");
    expect(res.content).toContain("description: Adversarial code reviewer");
    expect(res.content).toContain("tools: Read, Grep");
    expect(res.content).toContain("model: sonnet");
    expect(res.content).toContain("You are an adversarial reviewer.");
    expect(res.content).not.toContain("$ARGUMENTS");
    expect(res.content).not.toContain("allowed-tools");
  });

  it("supports 'claude' alias for claude-code harness", () => {
    const res = compileAgentForHarness(sampleAgent, "claude");
    expect(res.filename).toBe("reviewer.md");
    expect(res.content).toContain("name: reviewer");
    expect(res.content).not.toContain("$ARGUMENTS");
  });

  it("applies opencode-specific overrides and permission mapping", () => {
    const agentWithOverrides: UniversalAgent = {
      name: "custom-opencode",
      description: "Custom OpenCode subagent",
      mode: "subagent",
      model: "gpt-4o",
      tools: { allow: ["read", "glob"], deny: ["write"] },
      skills: ["test-skill"],
      opencode: {
        model: "anthropic/claude-3-7-sonnet",
        permission: {
          shell: "deny"
        }
      },
      prompt: "Custom instructions."
    };
    const res = compileAgentForHarness(agentWithOverrides, "opencode");
    expect(res.filename).toBe("custom-opencode.md");
    expect(res.content).toContain("anthropic/claude-3-7-sonnet");
    expect(res.content).toContain("read: allow");
    expect(res.content).toContain("shell: deny");
    expect(res.content).toContain("write: deny");
    expect(res.content).toContain("Custom instructions.");
  });

  it("ignores slash-command-only claude overrides and keeps subagent overrides", () => {
    const agent: UniversalAgent = {
      name: "security-auditor",
      description: "Audits security flaws",
      mode: "subagent",
      skills: [],
      claude: { command: "audit", argument_hint: "[path]", color: "red" },
      prompt: "Find vulnerabilities."
    };
    const res = compileAgentForHarness(agent, "claude-code");
    expect(res.filename).toBe("security-auditor.md");
    expect(res.content).toContain("color: red");
    expect(res.content).not.toContain("argument-hint");
    expect(res.content).not.toContain("command:");
  });

  it("sanitizes path traversal in claude agent name", () => {
    const base: UniversalAgent = { name: "x", description: "d", skills: [], prompt: "p" };
    expect(compileAgentForHarness({ ...base, name: "../../malicious/path/evil-cmd" }, "claude-code").filename).toBe("evil-cmd.md");
    expect(compileAgentForHarness({ ...base, name: "/etc/cron.d/audit.md" }, "claude-code").filename).toBe("audit.md");
    expect(compileAgentForHarness({ ...base, name: "..\\..\\evil_win" }, "claude-code").filename).toBe("evil_win.md");
    expect(compileAgentForHarness({ ...base, name: "..." }, "claude-code").filename).toBe("agent.md");
  });

  it("skips prototype pollution keys in opencode overrides and permissions", () => {
    const agentWithPollution: UniversalAgent = {
      name: "safe-agent",
      description: "Pollution test",
      mode: "subagent",
      skills: [],
      tools: {
        allow: ["read"],
        deny: ["shell"]
      },
      opencode: JSON.parse(
        '{"__proto__": {"polluted": true}, "constructor": {"bad": true}, "prototype": "bad", "allowedKey": "safeValue", "permission": {"__proto__": "deny", "customPerm": "allow"}}'
      ),
      prompt: "Safe prompt"
    };
    const res = compileAgentForHarness(agentWithPollution, "opencode");
    expect(res.content).not.toContain("__proto__");
    expect(res.content).not.toContain("constructor");
    expect(res.content).not.toContain("prototype");
    expect(res.content).toContain("allowedKey: safeValue");
    expect(res.content).toContain("customPerm: allow");
    expect(res.content).toContain("read: allow");
  });

  it("skips prototype pollution keys in claude overrides", () => {
    const agentWithPollutionClaude: UniversalAgent = {
      name: "safe-claude",
      description: "Claude pollution test",
      mode: "subagent",
      skills: [],
      claude: JSON.parse(
        '{"__proto__": "polluted", "constructor": "bad", "prototype": "bad", "safeOption": "good"}'
      ),
      prompt: "Claude prompt"
    };
    const res = compileAgentForHarness(agentWithPollutionClaude, "claude-code");
    expect(res.content).not.toContain("__proto__");
    expect(res.content).not.toContain("constructor");
    expect(res.content).not.toContain("prototype");
    expect(res.content).toContain("safeOption: good");
  });

  it("does not duplicate $ARGUMENTS if already present in prompt", () => {
    const agentWithArgs: UniversalAgent = {
      name: "custom-args",
      description: "Agent with args already in prompt",
      mode: "subagent",
      skills: [],
      prompt: "Analyze the following diff: $ARGUMENTS and report issues."
    };
    const res = compileAgentForHarness(agentWithArgs, "claude-code");
    expect(res.content).toContain("Analyze the following diff: $ARGUMENTS and report issues.");
    // Count occurrences of $ARGUMENTS
    const count = (res.content.match(/\$ARGUMENTS/g) || []).length;
    expect(count).toBe(1);
  });

  it("rejects claude-desktop as unsupported harness", () => {
    expect(() => compileAgentForHarness(sampleAgent, "claude-desktop")).toThrow(
      /unsupported harness.*claude-desktop/i
    );
  });

  it("throws descriptive error for unsupported harness", () => {
    expect(() => compileAgentForHarness(sampleAgent, "unknown-harness")).toThrow(
      /unsupported harness/i
    );
  });

  it("throws TypeError if agent is invalid or not an object", () => {
    expect(() => compileAgentForHarness(null as any, "opencode")).toThrow(TypeError);
    expect(() => compileAgentForHarness(undefined as any, "opencode")).toThrow(TypeError);
    expect(() => compileAgentForHarness("string" as any, "claude-code")).toThrow(TypeError);
  });
});
