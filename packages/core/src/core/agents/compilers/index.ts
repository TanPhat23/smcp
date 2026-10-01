import type { UniversalAgent } from "../../../types/index.ts";
import { compileClaudeAgent } from "./claude.ts";
import { compileOpenCodeAgent } from "./opencode.ts";
import type { CompiledAgentFile } from "./types.ts";

export * from "./types.ts";
export * from "./opencode.ts";
export * from "./claude.ts";

/**
 * Compiles a UniversalAgent definition into a native format for the specified harness.
 * Currently supports 'opencode' and 'claude-code' (or alias 'claude').
 *
 * @param agent The universal agent definition to compile.
 * @param harnessId The target agent harness identifier (e.g. 'opencode', 'claude-code', 'claude').
 * @returns The compiled agent file with filename and formatted content.
 * @throws TypeError if the agent definition is not an object.
 * @throws Error if the specified harness is not supported.
 */
export function compileAgentForHarness(
  agent: UniversalAgent,
  harnessId: string
): CompiledAgentFile {
  if (!agent || typeof agent !== "object") {
    throw new TypeError("Agent definition must be a valid object");
  }

  if (!harnessId || typeof harnessId !== "string") {
    throw new Error("Harness identifier must be a non-empty string");
  }

  const normalized = harnessId.trim().toLowerCase().replace(/\s+/g, "-");

  switch (normalized) {
    case "opencode":
      return compileOpenCodeAgent(agent);
    case "claude":
    case "claude-code":
      return compileClaudeAgent(agent);
    default:
      throw new Error(
        `Unsupported harness for agent compilation: '${harnessId}'. Supported harnesses: opencode, claude-code`
      );
  }
}
