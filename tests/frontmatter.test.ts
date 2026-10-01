import { describe, expect, it } from "bun:test";
import { parseAgentMarkdown } from "../packages/core/src/core/agents/frontmatter.ts";
import { ManifestSchema } from "../packages/core/src/types/manifest.ts";

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
    expect(parsed.tools).toEqual({
      allow: ["read", "grep"],
      deny: ["edit", "write"]
    });
    if (parsed.tools && !Array.isArray(parsed.tools)) {
      expect(parsed.tools.allow).toEqual(["read", "grep"]);
      expect(parsed.tools.deny).toEqual(["edit", "write"]);
    }
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

  it("throws an error when markdown has no frontmatter", () => {
    const raw = `# Just prompt without frontmatter`;
    expect(() => parseAgentMarkdown(raw, "no-frontmatter.md")).toThrow(/frontmatter/i);
  });

  it("handles empty prompt body gracefully", () => {
    const raw = `---
name: minimal-agent
description: Minimal agent
---`;
    const parsed = parseAgentMarkdown(raw);
    expect(parsed.name).toBe("minimal-agent");
    expect(parsed.description).toBe("Minimal agent");
    expect(parsed.prompt).toBe("");
    expect(parsed.mode).toBe("subagent");
    expect(parsed.skills).toEqual([]);
  });

  it("parses tools as an array of strings", () => {
    const raw = `---
name: simple-tools-agent
description: Agent with flat tools array
tools: [read, grep, glob]
---
Prompt body`;
    const parsed = parseAgentMarkdown(raw);
    expect(parsed.tools).toEqual(["read", "grep", "glob"]);
  });

  it("parses skills as list and handles extra harness metadata", () => {
    const raw = `---
name: full-agent
description: Full agent specification
mode: primary
model: gpt-4o
temperature: 0.2
skills:
  - code-review-and-quality
  - security-review
codex:
  reasoning_effort: medium
opencode:
  permission:
    edit: deny
claude:
  command: audit
cursor:
  alwaysApply: false
---
Prompt here`;
    const parsed = parseAgentMarkdown(raw);
    expect(parsed.name).toBe("full-agent");
    expect(parsed.mode).toBe("primary");
    expect(parsed.temperature).toBe(0.2);
    expect(parsed.skills).toEqual(["code-review-and-quality", "security-review"]);
    expect(parsed.opencode).toEqual({ permission: { edit: "deny" } });
    expect(parsed.claude).toEqual({ command: "audit" });
    expect(parsed.cursor).toEqual({ alwaysApply: false });
  });

  it("validates agent name format", () => {
    const raw = `---
name: invalid name with spaces!
description: Description
---
Prompt`;
    expect(() => parseAgentMarkdown(raw)).toThrow(/alphanumeric/i);
  });

  it("throws descriptive error for invalid YAML syntax", () => {
    const raw = `---
name: reviewer
description: [unclosed list
---
Prompt`;
    expect(() => parseAgentMarkdown(raw, "invalid-yaml.md")).toThrow(/failed to parse yaml frontmatter in 'invalid-yaml.md'/i);
  });

  it("throws TypeError if content is not a string", () => {
    expect(() => parseAgentMarkdown(null as any)).toThrow(TypeError);
  });
});

describe("ManifestSchema with agents", () => {
  it("validates manifest with agents list", () => {
    const raw = {
      name: "my-agent-pack",
      version: "1.0.0",
      description: "Pack with agents",
      agents: [
        {
          name: "reviewer",
          path: "agents/reviewer.md",
          description: "Adversarial code reviewer",
          mode: "subagent",
          model: "claude-3-7-sonnet"
        }
      ]
    };

    const parsed = ManifestSchema.parse(raw);
    expect(parsed.agents).toBeDefined();
    expect(parsed.agents?.length).toBe(1);
    expect(parsed.agents?.[0].name).toBe("reviewer");
    expect(parsed.agents?.[0].mode).toBe("subagent");
  });

  it("defaults agents to empty array if omitted", () => {
    const raw = {
      name: "pack-without-agents",
      version: "1.0.0"
    };

    const parsed = ManifestSchema.parse(raw);
    expect(parsed.agents).toEqual([]);
  });
});
