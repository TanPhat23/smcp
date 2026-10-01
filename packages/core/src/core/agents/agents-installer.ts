import path from "node:path";
import type { UniversalAgent } from "../../types/index.ts";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import { expandHome } from "../../utils/paths.ts";
import { containsNullByte, isPrototypePollutionKey, isWindowsReservedName } from "../../utils/security.ts";
import { isStrictlyInside } from "../merger/helpers.ts";
import { compileAgentForHarness } from "./compilers/index.ts";
import { resolveActiveAgentPath, type ResolveActivePathOptions } from "./detector.ts";
import { getAgentProfiles } from "./profiles.ts";

export interface InstallAgentFilesOptions extends ResolveActivePathOptions {}

export interface InstallAgentResult {
  writtenPath: string;
}

/**
 * Installs compiled agent files into the target agent harness directory.
 *
 * Can be called with:
 * 1. Direct destination directory: `installAgentFiles(agentBaseDir, agent, harnessId)`
 * 2. Target agent harness ID with scoped resolution: `installAgentFiles(targetAgentId, agent, options)`
 *
 * @param agentBaseDirOrAgentId Destination directory path OR agent harness identifier (e.g. 'opencode', 'claude-code').
 * @param agent Universal agent definition to compile and install.
 * @param harnessIdOrOptions Harness identifier string or options object for scoped path resolution.
 * @returns Object containing the written file path.
 */
export function installAgentFiles(
  agentBaseDirOrAgentId: string,
  agent: UniversalAgent,
  harnessIdOrOptions: string | InstallAgentFilesOptions = "opencode"
): InstallAgentResult {
  if (!agentBaseDirOrAgentId || typeof agentBaseDirOrAgentId !== "string" || agentBaseDirOrAgentId.trim() === "") {
    throw new TypeError("Agent directory or target agent ID must be a non-empty string");
  }

  if (containsNullByte(agentBaseDirOrAgentId)) {
    throw new Error("Agent directory or target agent ID contains null bytes");
  }

  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    throw new TypeError("Agent definition must be a valid object");
  }

  let agentBaseDir: string;
  let harnessId: string;

  if (typeof harnessIdOrOptions === "string") {
    agentBaseDir = agentBaseDirOrAgentId;
    harnessId = harnessIdOrOptions;
  } else if (typeof harnessIdOrOptions === "object" && harnessIdOrOptions !== null) {
    const targetAgentId = agentBaseDirOrAgentId.trim();
    harnessId = targetAgentId;
    const profiles = getAgentProfiles();
    const profile = profiles[targetAgentId];
    if (!profile) {
      throw new Error(`Unknown agent ID: '${targetAgentId}'`);
    }
    if (!profile.agents || !Array.isArray(profile.agents.paths) || profile.agents.paths.length === 0) {
      throw new Error(`Agent '${targetAgentId}' does not support agents or has no agent paths configured`);
    }
    const resolved = resolveActiveAgentPath(profile.agents.paths, harnessIdOrOptions);
    if (!resolved) {
      throw new Error(`Could not resolve active agent path for '${targetAgentId}'`);
    }
    agentBaseDir = resolved;
  } else {
    agentBaseDir = agentBaseDirOrAgentId;
    harnessId = "opencode";
  }

  // Compile agent definition into native file
  const compiled = compileAgentForHarness(agent, harnessId);

  if (containsNullByte(compiled.filename)) {
    throw new Error("Compiled agent filename contains null bytes");
  }

  // Sanitize filename across POSIX and Windows separators
  const normalizedFilename = compiled.filename.replace(/\\/g, "/");
  const safeBasename = path.basename(normalizedFilename).trim().replace(/^\.+/, "");

  if (isPrototypePollutionKey(safeBasename)) {
    throw new Error(`Invalid agent filename: prototype pollution key '${safeBasename}'`);
  }

  if (isWindowsReservedName(safeBasename)) {
    throw new Error(`Invalid agent filename: Windows reserved name '${safeBasename}'`);
  }

  const finalFilename = safeBasename || `${agent.name || "agent"}.md`;
  const resolvedBaseDir = path.resolve(expandHome(agentBaseDir));
  const writtenPath = path.resolve(resolvedBaseDir, finalFilename);

  if (!isStrictlyInside(resolvedBaseDir, writtenPath)) {
    throw new Error(`Path traversal detected: target path '${writtenPath}' is outside base directory '${resolvedBaseDir}'`);
  }

  atomicWriteFileSync(writtenPath, compiled.content);

  return { writtenPath };
}
