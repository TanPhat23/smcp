import fs from "node:fs";
import path from "node:path";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import { expandHome } from "../../utils/paths.ts";
import {
  containsNullByte,
  isPrototypePollutionKey,
  isWindowsReservedName
} from "../../utils/security.ts";
import { isRuleFilePath } from "../agents/rules.ts";
import { isStrictlyInside } from "./helpers.ts";

/**
 * Safely writes a rule file either to an explicit rule file path (e.g. `~/.claude/CLAUDE.md`,
 * `~/.gemini/GEMINI.md`, `./CLAUDE.md`, `./AGENTS.md`, `./.cursorrules`) or inside a target
 * rules directory (`./.claude/rules/<name>.md`, `./.agents/rules/<name>.md`).
 */
export function installRuleFile(
  targetDirOrFilePath: string,
  ruleName: string,
  content: string
): string {
  if (!targetDirOrFilePath || typeof targetDirOrFilePath !== "string") {
    throw new Error("Invalid rule destination path: must be a non-empty string");
  }
  if (
    !ruleName ||
    typeof ruleName !== "string" ||
    !ruleName.trim() ||
    ruleName.includes("..") ||
    ruleName.includes("/") ||
    ruleName.includes("\\") ||
    containsNullByte(ruleName) ||
    isPrototypePollutionKey(ruleName) ||
    isWindowsReservedName(ruleName)
  ) {
    throw new Error(`Invalid rule name: ${ruleName}`);
  }

  const resolvedDest = path.resolve(expandHome(targetDirOrFilePath));
  if (isRuleFilePath(resolvedDest)) {
    atomicWriteFileSync(resolvedDest, content);
    return resolvedDest;
  }

  const fileName =
    ruleName.toLowerCase().endsWith(".md") || ruleName.toLowerCase().endsWith(".mdc")
      ? ruleName
      : `${ruleName}.md`;
  if (!fs.existsSync(resolvedDest)) {
    fs.mkdirSync(resolvedDest, { recursive: true });
  }
  const canonicalBase = fs.realpathSync(resolvedDest);
  const targetFile = path.resolve(canonicalBase, fileName);
  if (!isStrictlyInside(canonicalBase, targetFile)) {
    throw new Error(`Directory traversal detected in rule file: ${ruleName}`);
  }
  atomicWriteFileSync(targetFile, content);
  return targetFile;
}
