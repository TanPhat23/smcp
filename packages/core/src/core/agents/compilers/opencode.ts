import path from "node:path";
import YAML from "yaml";
import type { UniversalAgent } from "../../../types/index.ts";
import { isPrototypePollutionKey } from "../../../utils/security.ts";
import type { CompiledAgentFile } from "./types.ts";

/**
 * Compiles a UniversalAgent into native OpenCode subagent Markdown with YAML frontmatter.
 *
 * @param agent The universal agent definition.
 * @returns CompiledAgentFile containing filename (e.g. `reviewer.md`) and content.
 */
export function compileOpenCodeAgent(agent: UniversalAgent): CompiledAgentFile {
  if (!agent || typeof agent !== "object") {
    throw new TypeError("Agent definition must be a valid object");
  }

  const rawName = (agent.name ?? "").replace(/\\/g, "/");
  const baseNameFromPath = path.basename(rawName).trim().replace(/^\.+/, "");
  const safeName = baseNameFromPath || "agent";
  const baseName = safeName.endsWith(".md") ? safeName.slice(0, -3) : safeName;
  const filename = `${baseName || "agent"}.md`;

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
          if (!isPrototypePollutionKey(tool)) {
            permissions[tool] = "allow";
          }
        }
      }
      if (Array.isArray(agent.tools.deny)) {
        for (const tool of agent.tools.deny) {
          if (!isPrototypePollutionKey(tool)) {
            permissions[tool] = "deny";
          }
        }
      }
    }
  }

  // Apply opencode-specific overrides safely
  if (agent.opencode && typeof agent.opencode === "object") {
    for (const [key, value] of Object.entries(agent.opencode)) {
      if (isPrototypePollutionKey(key)) continue;
      if (key === "permission" && value && typeof value === "object" && !Array.isArray(value)) {
        for (const [permKey, permVal] of Object.entries(value)) {
          if (isPrototypePollutionKey(permKey)) continue;
          if (typeof permVal === "string") {
            permissions[permKey] = permVal;
          }
        }
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
