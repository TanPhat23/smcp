import fs from "node:fs";
import path from "node:path";
import { expandHome } from "../../utils/paths.ts";
import { stripJsonComments } from "./jsonc.ts";

export interface JsonConfigFilterRule {
  includeOnly: string[];
  exclude: string[];
}

export interface ResolvedJsonConfigEntryDir {
  dirPath: string;
  includeOnly: string[];
  exclude: string[];
}

interface RawPathSpec {
  path: string;
  includeOnly: string[];
  exclude: string[];
}

const MAX_INHERIT_DEPTH = 16;

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === "object" && !Array.isArray(val));
}

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function resolveConfiguredPath(rawPath: string, configDir: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return expandHome(trimmed);
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  const relativeToConfig = path.resolve(configDir, trimmed);
  if (fs.existsSync(relativeToConfig)) {
    return relativeToConfig;
  }
  return path.resolve(process.cwd(), trimmed);
}

function parsePathSpecArray(val: unknown): RawPathSpec[] {
  if (!Array.isArray(val)) return [];
  const specs: RawPathSpec[] = [];
  for (const item of val) {
    if (!isPlainRecord(item) || typeof item.path !== "string" || !item.path.trim()) {
      continue;
    }
    specs.push({
      path: item.path.trim(),
      includeOnly: toStringArray(item.include_only),
      exclude: toStringArray(item.exclude)
    });
  }
  return specs;
}

function matchesFilterPattern(name: string, pattern: string): boolean {
  if (name === pattern) return true;
  // Guard against overly long / pathological regex patterns
  if (pattern.length > 200) return false;
  try {
    const re = new RegExp(`^(?:${pattern})$`);
    return re.test(name);
  } catch {
    return false;
  }
}

export function isItemIncludedByJsonConfig(
  itemName: string,
  includeOnly: readonly string[],
  exclude: readonly string[]
): boolean {
  if (exclude.some((pat) => matchesFilterPattern(itemName, pat))) {
    return false;
  }
  if (includeOnly.length > 0) {
    return includeOnly.some((pat) => matchesFilterPattern(itemName, pat));
  }
  return true;
}

function collectEntriesRecursive(
  jsonConfigPath: string,
  inheritedInclude: readonly string[],
  inheritedExclude: readonly string[],
  visited: Set<string>,
  depth: number,
  out: ResolvedJsonConfigEntryDir[]
): void {
  if (depth > MAX_INHERIT_DEPTH) return;

  let realPath: string;
  try {
    if (!fs.existsSync(jsonConfigPath) || !fs.statSync(jsonConfigPath).isFile()) {
      return;
    }
    realPath = fs.realpathSync(jsonConfigPath);
  } catch {
    return;
  }

  if (visited.has(realPath)) return;
  visited.add(realPath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(fs.readFileSync(realPath, "utf8")));
  } catch {
    return;
  }
  if (!isPlainRecord(parsed)) return;

  const configDir = path.dirname(realPath);
  const topExclude = [...inheritedExclude, ...toStringArray(parsed.exclude)];

  for (const inheritSpec of parsePathSpecArray(parsed.inherits)) {
    const targetConfig = resolveConfiguredPath(inheritSpec.path, configDir);
    collectEntriesRecursive(
      targetConfig,
      inheritSpec.includeOnly.length > 0 ? inheritSpec.includeOnly : inheritedInclude,
      [...topExclude, ...inheritSpec.exclude],
      visited,
      depth + 1,
      out
    );
  }

  for (const entrySpec of parsePathSpecArray(parsed.entries)) {
    const entryDir = resolveConfiguredPath(entrySpec.path, configDir);
    const effectiveInclude =
      entrySpec.includeOnly.length > 0 ? entrySpec.includeOnly : [...inheritedInclude];
    const effectiveExclude = [...topExclude, ...entrySpec.exclude];
    out.push({
      dirPath: entryDir,
      includeOnly: effectiveInclude,
      exclude: effectiveExclude
    });
  }
}

/**
 * Resolves Antigravity `skills.json` / `plugins.json` `entries` and `inherits` chains
 * into ordered directory descriptors with include/exclude filters.
 */
export function resolveJsonConfigEntryDirs(jsonConfigPath: string): ResolvedJsonConfigEntryDir[] {
  if (!jsonConfigPath) return [];
  const resolved = expandHome(jsonConfigPath);
  const out: ResolvedJsonConfigEntryDir[] = [];
  collectEntriesRecursive(resolved, [], [], new Set<string>(), 0, out);
  return out;
}
