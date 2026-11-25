import fs from "node:fs";
import path from "node:path";
import type { RuleEntry } from "../../types/index.ts";
import { hashContent } from "../../utils/crypto.ts";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { isGlobalConfigPath } from "./detector.ts";
import { isItemIncludedByJsonConfig, resolveJsonConfigEntryDirs } from "./json-configs.ts";

const SPECIAL_RULE_FILENAMES = new Set([".cursorrules", ".windsurfrules"]);

export function isRuleFilePath(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base.endsWith(".md") || base.endsWith(".mdc") || SPECIAL_RULE_FILENAMES.has(base);
}

function isRuleDirEntry(name: string): boolean {
  const lower = name.toLowerCase();
  return !name.startsWith(".") && (lower.endsWith(".md") || lower.endsWith(".mdc"));
}

function extractRuleStem(filePath: string): string {
  const base = path.basename(filePath);
  if (SPECIAL_RULE_FILENAMES.has(base.toLowerCase())) {
    return base.replace(/^\./, "");
  }
  return path.basename(filePath, path.extname(filePath));
}

function addRuleFile(
  filePath: string,
  preferredName: string,
  seenRealPaths: Set<string>,
  seenNames: Set<string>,
  rules: RuleEntry[]
): void {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
    const realPath = fs.realpathSync(filePath);
    if (seenRealPaths.has(realPath)) return;

    const content = fs.readFileSync(realPath, "utf8");
    let finalName = preferredName;
    if (isPrototypePollutionKey(finalName) || !finalName) return;
    if (seenNames.has(finalName)) {
      let idx = 2;
      while (seenNames.has(`${finalName}-${idx}`)) idx++;
      finalName = `${finalName}-${idx}`;
    }

    seenRealPaths.add(realPath);
    seenNames.add(finalName);

    rules.push({
      name: finalName,
      path: realPath,
      contentHash: hashContent(content),
      content
    });
  } catch {
    // Ignore unreadable rule file
  }
}

function scanRuleDirectory(
  dirPath: string,
  includeOnly: readonly string[],
  exclude: readonly string[],
  seenRealPaths: Set<string>,
  seenNames: Set<string>,
  rules: RuleEntry[]
): void {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return;
    const items = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((item) => isRuleDirEntry(item.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const item of items) {
      const ruleName = extractRuleStem(item.name);
      if (!isItemIncludedByJsonConfig(ruleName, includeOnly, exclude)) continue;
      addRuleFile(path.join(dirPath, item.name), ruleName, seenRealPaths, seenNames, rules);
    }
  } catch {
    // Ignore directory read error
  }
}

/**
 * Scans configured rule files and directories across agents (`CLAUDE.md`, `GEMINI.md`,
 * `AGENTS.md`, `.cursorrules`, `.windsurfrules`, `.claude/rules`, `.agents/rules`,
 * `.cursor/rules`, `.windsurf/rules`, plus `rules.json`), deduplicating by resolved path.
 */
export function scanRules(rulesPaths: readonly string[]): RuleEntry[] {
  if (!rulesPaths || rulesPaths.length === 0) return [];

  const rules: RuleEntry[] = [];
  const seenRealPaths = new Set<string>();
  const seenNames = new Set<string>();
  const scannedRulesJson = new Set<string>();

  for (const rawPath of rulesPaths) {
    if (!rawPath || typeof rawPath !== "string") continue;
    const resolved = isGlobalConfigPath(rawPath)
      ? expandHome(rawPath)
      : path.resolve(expandHome(rawPath));

    try {
      if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        if (stat.isFile() && isRuleFilePath(resolved)) {
          const baseStem = extractRuleStem(resolved);
          const preferredName = isGlobalConfigPath(rawPath) ? `global-${baseStem}` : baseStem;
          addRuleFile(resolved, preferredName, seenRealPaths, seenNames, rules);
        } else if (stat.isDirectory()) {
          scanRuleDirectory(resolved, [], [], seenRealPaths, seenNames, rules);
        }
      }
    } catch {
      // Ignore path stat errors
    }

    const baseDir = path.dirname(resolved);
    const rulesJsonPath = path.join(baseDir, "rules.json");
    if (!scannedRulesJson.has(rulesJsonPath)) {
      scannedRulesJson.add(rulesJsonPath);
      for (const extraDir of resolveJsonConfigEntryDirs(rulesJsonPath)) {
        scanRuleDirectory(
          extraDir.dirPath,
          extraDir.includeOnly,
          extraDir.exclude,
          seenRealPaths,
          seenNames,
          rules
        );
      }
    }
  }

  return rules;
}
