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

  it("compiles for Claude Code (.md slash command with $ARGUMENTS)", () => {
    const res = compileAgentForHarness(sampleAgent, "claude-code");
    expect(res.filename).toBe("reviewer.md");
    expect(res.content).toContain("description: Adversarial code reviewer");
    expect(res.content).toContain("$ARGUMENTS");
    expect(res.content).toContain("You are an adversarial reviewer.");
  });

  it("supports 'claude' alias for claude-code harness", () => {
    const res = compileAgentForHarness(sampleAgent, "claude");
    expect(res.filename).toBe("reviewer.md");
    expect(res.content).toContain("description: Adversarial code reviewer");
    expect(res.content).toContain("$ARGUMENTS");
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

  it("uses claude command override for filename if specified", () => {
    const agentWithCmd: UniversalAgent = {
      name: "security-auditor",
      description: "Audits security flaws",
      mode: "subagent",
      skills: [],
      claude: {
        command: "audit",
        argument_hint: "[path]"
      },
      prompt: "Find vulnerabilities."
    };
    const res = compileAgentForHarness(agentWithCmd, "claude-code");
    expect(res.filename).toBe("audit.md");
    expect(res.content).toContain("argument-hint: \"[path]\"");
    expect(res.content).toContain("$ARGUMENTS");
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

  it("throws descriptive error for unsupported harness", () => {
    expect(() => compileAgentForHarness(sampleAgent, "unknown-harness")).toThrow(
      /unsupported harness/i
    );
  });
});
