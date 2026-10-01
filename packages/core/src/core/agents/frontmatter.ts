import YAML from "yaml";
import {
  UniversalAgentFrontmatterSchema,
  type UniversalAgent,
} from "../../types/index.ts";

/**
 * Regex to extract YAML frontmatter delimited by `---` at the beginning of markdown content.
 * Matches starting `---`, frontmatter YAML content, closing `---`, and trailing prompt body.
 */
const FRONTMATTER_REGEX =
  /^(?:---|\ufeff---)[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/**
 * Parses markdown content with YAML frontmatter into a validated UniversalAgent.
 *
 * @param content The raw markdown string containing YAML frontmatter and optional prompt body.
 * @param filename Optional filename used for error messages.
 * @returns The parsed and validated UniversalAgent object.
 * @throws Error if frontmatter delimiter is missing, YAML syntax is invalid, or schema validation fails.
 */
export function parseAgentMarkdown(content: string, filename?: string): UniversalAgent {
  if (typeof content !== "string") {
    throw new TypeError("Agent markdown content must be a string");
  }

  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) {
    const target = filename ? `Agent file '${filename}'` : "Agent markdown";
    throw new Error(`${target} does not contain valid YAML frontmatter`);
  }

  const rawYaml = match[1];
  const prompt = match[2] ?? "";

  let parsedYaml: unknown;
  try {
    parsedYaml = YAML.parse(rawYaml);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const target = filename ? ` in '${filename}'` : "";
    throw new Error(`Failed to parse YAML frontmatter${target}: ${errorMsg}`);
  }

  // Handle empty or missing YAML frontmatter (YAML.parse returns null/undefined)
  const frontmatterData =
    parsedYaml === null || typeof parsedYaml === "undefined" ? {} : parsedYaml;

  const validationResult = UniversalAgentFrontmatterSchema.safeParse(frontmatterData);
  if (!validationResult.success) {
    const issueMessages = validationResult.error.issues.map(
      (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`
    );
    const prefix = filename ? `Invalid frontmatter in '${filename}'` : "Invalid frontmatter";
    throw new Error(`${prefix}: ${issueMessages.join("; ")}`);
  }

  return {
    ...validationResult.data,
    prompt,
  };
}
