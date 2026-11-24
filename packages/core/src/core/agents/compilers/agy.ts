import YAML from "yaml";
import type { UniversalAgent } from "../../../types/index.ts";
import { isPrototypePollutionKey } from "../../../utils/security.ts";
import { extractAllowTools, sanitizeAgentFilename } from "./helpers.ts";
import type { CompiledAgentFile } from "./types.ts";

/**
 * Compiles a UniversalAgent into an Antigravity (`agy`) custom subagent Markdown file
 * (`~/.gemini/config/agents/<name>.md` or `.agents/agents/<name>.md`).
 */
export function compileAgyAgent(agent: UniversalAgent): CompiledAgentFile {
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
    frontmatter.tools = tools;
  }

  if (typeof agent.model === "string" && agent.model.trim()) {
    frontmatter.model = agent.model.trim();
  }

  if (Array.isArray(agent.skills) && agent.skills.length > 0) {
    frontmatter.skills = agent.skills;
  }

  if (agent.mode === "primary") {
    frontmatter.mainAgent = true;
    frontmatter.subagent = false;
  } else if (agent.mode === "subagent") {
    frontmatter.mainAgent = false;
    frontmatter.subagent = true;
  } else if (agent.mode === "all") {
    frontmatter.mainAgent = true;
    frontmatter.subagent = true;
  }

  if (agent.agy && typeof agent.agy === "object" && !Array.isArray(agent.agy)) {
    for (const [key, value] of Object.entries(agent.agy)) {
      if (isPrototypePollutionKey(key)) continue;
      frontmatter[key] = value;
    }
  }

  const body = agent.prompt?.trim() ?? "";
  const frontmatterYaml = YAML.stringify(frontmatter).trimEnd();
  const content = body
    ? `---\n${frontmatterYaml}\n---\n\n${body}\n`
    : `---\n${frontmatterYaml}\n---\n`;

  return { filename, content };
}
