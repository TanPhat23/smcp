import path from "node:path";
import YAML from "yaml";
import type { UniversalAgent } from "../../../types/index.ts";
import { isPrototypePollutionKey } from "../../../utils/security.ts";
import type { CompiledAgentFile } from "./types.ts";

/**
 * Compiles a UniversalAgent into a Claude Code custom slash command Markdown file.
 *
 * @param agent The universal agent definition.
 * @returns CompiledAgentFile containing filename (e.g. `reviewer.md`) and content with $ARGUMENTS.
 */
export function compileClaudeAgent(agent: UniversalAgent): CompiledAgentFile {
  if (!agent || typeof agent !== "object") {
    throw new TypeError("Agent definition must be a valid object");
  }

  const rawCmd =
    typeof agent.claude?.command === "string" && agent.claude.command.trim()
      ? agent.claude.command.trim()
      : agent.name;

  // Sanitize path traversal characters across both POSIX and Windows separators
  const normalizedCmd = (rawCmd || "").replace(/\\/g, "/");
  const baseCmd = path.basename(normalizedCmd).trim().replace(/^\.+/, "");
  const fallbackName = agent.name ? path.basename(agent.name.replace(/\\/g, "/")).trim().replace(/^\.+/, "") : "";
  const safeName = baseCmd || fallbackName || "agent";
  const baseName = safeName.endsWith(".md") ? safeName.slice(0, -3) : safeName;
  const filename = `${baseName || "agent"}.md`;

  const frontmatter: Record<string, unknown> = {
    description: agent.description
  };

  if (agent.tools) {
    if (Array.isArray(agent.tools)) {
      frontmatter["allowed-tools"] = agent.tools;
    } else if (Array.isArray(agent.tools.allow) && agent.tools.allow.length > 0) {
      frontmatter["allowed-tools"] = agent.tools.allow;
    }
  }

  // Apply claude-specific overrides safely
  if (agent.claude && typeof agent.claude === "object") {
    for (const [key, value] of Object.entries(agent.claude)) {
      if (isPrototypePollutionKey(key)) continue;
      if (key === "command") continue;
      if (key === "argument_hint") {
        frontmatter["argument-hint"] = value;
      } else {
        frontmatter[key] = value;
      }
    }
  }

  let body = agent.prompt?.trim() ?? "";
  if (!body.includes("$ARGUMENTS")) {
    body = body ? `${body}\n\nContext & arguments: $ARGUMENTS` : "Context & arguments: $ARGUMENTS";
  }

  const frontmatterYaml = YAML.stringify(frontmatter).trimEnd();
  const content = `---\n${frontmatterYaml}\n---\n\n${body}\n`;

  return {
    filename,
    content
  };
}
