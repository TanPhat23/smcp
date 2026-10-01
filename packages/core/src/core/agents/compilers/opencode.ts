import YAML from "yaml";
import type { UniversalAgent } from "../../../types/index.ts";
import type { CompiledAgentFile } from "./types.ts";

/**
 * Compiles a UniversalAgent into native OpenCode subagent Markdown with YAML frontmatter.
 *
 * @param agent The universal agent definition.
 * @returns CompiledAgentFile containing filename (e.g. `reviewer.md`) and content.
 */
export function compileOpenCodeAgent(agent: UniversalAgent): CompiledAgentFile {
  const baseName = agent.name.endsWith(".md") ? agent.name.slice(0, -3) : agent.name;
  const filename = `${baseName}.md`;

  const frontmatter: Record<string, unknown> = {
    name: agent.name,
    description: agent.description,
    mode: agent.mode ?? "subagent"
  };

  if (agent.model) {
    frontmatter.model = agent.model;
  }
  if (typeof agent.temperature === "number") {
    frontmatter.temperature = agent.temperature;
  }
  if (Array.isArray(agent.skills) && agent.skills.length > 0) {
    frontmatter.skills = agent.skills;
  }

  const permissions: Record<string, string> = {};
  if (agent.tools) {
    if (Array.isArray(agent.tools)) {
      frontmatter.tools = agent.tools;
    } else {
      if (Array.isArray(agent.tools.allow)) {
        for (const tool of agent.tools.allow) {
          permissions[tool] = "allow";
        }
      }
      if (Array.isArray(agent.tools.deny)) {
        for (const tool of agent.tools.deny) {
          permissions[tool] = "deny";
        }
      }
    }
  }

  // Apply opencode-specific overrides
  if (agent.opencode && typeof agent.opencode === "object") {
    for (const [key, value] of Object.entries(agent.opencode)) {
      if (key === "permission" && value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(permissions, value);
      } else {
        frontmatter[key] = value;
      }
    }
  }

  if (Object.keys(permissions).length > 0) {
    frontmatter.permission = permissions;
  }

  const frontmatterYaml = YAML.stringify(frontmatter).trimEnd();
  const prompt = agent.prompt?.trim();
  const content = prompt
    ? `---\n${frontmatterYaml}\n---\n\n${prompt}\n`
    : `---\n${frontmatterYaml}\n---\n`;

  return {
    filename,
    content
  };
}
