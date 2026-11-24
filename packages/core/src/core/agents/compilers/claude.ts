import YAML from "yaml";
import type { UniversalAgent } from "../../../types/index.ts";
import { isPrototypePollutionKey } from "../../../utils/security.ts";
import { extractAllowTools, sanitizeAgentFilename } from "./helpers.ts";
import type { CompiledAgentFile } from "./types.ts";

/** Keys that only make sense for the slash-command flavour and must not leak into a subagent. */
const COMMAND_ONLY_KEYS = new Set(["command", "argument_hint", "argument-hint", "allowed-tools"]);

/**
 * Compiles a UniversalAgent into a Claude Code subagent Markdown file
 * (`~/.claude/agents/<name>.md`) with `name`, `description`, `tools` and `model`
 * frontmatter followed by the system prompt.
 *
 * @param agent The universal agent definition.
 * @returns CompiledAgentFile containing filename (e.g. `reviewer.md`) and content.
 */
export function compileClaudeAgent(agent: UniversalAgent): CompiledAgentFile {
  if (!agent || typeof agent !== "object") {
    throw new TypeError("Agent definition must be a valid object");
  }

  const { stem, filename } = sanitizeAgentFilename(agent.name);

  const frontmatter: Record<string, unknown> = {
    name: stem,
    description: agent.description
  };

  const tools = extractAllowTools(agent.tools);
  if (tools) {
    frontmatter.tools = tools.join(", ");
  }

  if (typeof agent.model === "string" && agent.model.trim()) {
    frontmatter.model = agent.model.trim();
  }

  // Apply claude-specific overrides safely
  if (agent.claude && typeof agent.claude === "object") {
    for (const [key, value] of Object.entries(agent.claude)) {
      if (isPrototypePollutionKey(key) || COMMAND_ONLY_KEYS.has(key)) continue;
      frontmatter[key] = Array.isArray(value) && key === "tools" ? value.join(", ") : value;
    }
  }

  const body = agent.prompt?.trim() ?? "";
  const frontmatterYaml = YAML.stringify(frontmatter).trimEnd();
  const content = `---\n${frontmatterYaml}\n---\n\n${body}\n`;

  return { filename, content };
}
