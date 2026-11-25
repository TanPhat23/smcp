import fs from "node:fs";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey, stripPrototypePollutionKeys } from "../../utils/security.ts";
import { stripJsonComments } from "./jsonc.ts";

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === "object" && !Array.isArray(val));
}

/**
 * Reads installed lifecycle hooks from either a standalone `hooks.json` file (root object)
 * or an agent settings file under a configured key (e.g. Claude Code `settings.json` -> `"hooks"`).
 */
export function readInstalledHooks(
  hooksConfigPath: string,
  key?: string
): Record<string, unknown> {
  if (!hooksConfigPath) return {};
  if (key && isPrototypePollutionKey(key)) return {};
  try {
    const resolved = expandHome(hooksConfigPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return {};
    }
    const raw = fs.readFileSync(resolved, "utf8");
    const parsed: unknown = JSON.parse(stripJsonComments(raw));
    if (!isPlainRecord(parsed)) return {};

    const sourceMap: unknown = key
      ? (Object.hasOwn(parsed, key) ? parsed[key] : undefined)
      : parsed;
    if (!isPlainRecord(sourceMap)) return {};

    const result: Record<string, unknown> = {};
    for (const [hookName, hookDef] of Object.entries(sourceMap)) {
      if (isPrototypePollutionKey(hookName)) continue;
      if (isPlainRecord(hookDef) || Array.isArray(hookDef)) {
        result[hookName] = hookDef;
      }
    }
    stripPrototypePollutionKeys(result);
    return result;
  } catch {
    return {};
  }
}
