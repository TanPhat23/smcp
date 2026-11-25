import fs from "node:fs";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey, stripPrototypePollutionKeys } from "../../utils/security.ts";
import { stripJsonComments } from "../agents/jsonc.ts";

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === "object" && !Array.isArray(val));
}

/**
 * Merges lifecycle hook definitions into a target config file (either at the root object
 * for `hooks.json` or under `config[key]` for embedded settings like Claude Code `settings.json`)
 * while preserving existing user-defined settings and rejecting corrupt non-JSON configs.
 */
export function mergeHooksIntoFile(
  filePath: string,
  newHooks: Record<string, unknown>,
  key?: string
): string[] {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Invalid filePath: must be a non-empty string");
  }
  if (key && isPrototypePollutionKey(key)) {
    throw new Error(`Invalid hooks key: ${key}`);
  }

  const resolvedPath = expandHome(filePath);
  let writePath = resolvedPath;
  let existing: Record<string, unknown> = {};

  if (fs.existsSync(resolvedPath)) {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`Target path is not a file: ${resolvedPath}`);
    }
    writePath = fs.realpathSync(resolvedPath);
    const raw = fs.readFileSync(writePath, "utf8");
    if (raw.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripJsonComments(raw));
      } catch (err: unknown) {
        throw new Error(
          `Refusing to modify ${resolvedPath}: file is not valid JSON (${err instanceof Error ? err.message : String(err)}). Fix or remove it and retry.`
        );
      }
      if (isPlainRecord(parsed)) {
        existing = parsed;
      }
    }
  }

  stripPrototypePollutionKeys(existing);

  let targetMap: Record<string, unknown>;
  if (key) {
    const sub = existing[key];
    targetMap = isPlainRecord(sub) ? { ...sub } : {};
    stripPrototypePollutionKeys(targetMap);
  } else {
    targetMap = existing;
  }

  const mergedNames: string[] = [];
  if (isPlainRecord(newHooks)) {
    for (const [hookName, hookDef] of Object.entries(newHooks)) {
      if (isPrototypePollutionKey(hookName)) continue;
      if (isPlainRecord(hookDef) || Array.isArray(hookDef)) {
        targetMap[hookName] = hookDef;
        mergedNames.push(hookName);
      }
    }
  }

  if (key) {
    existing[key] = targetMap;
  }

  if (mergedNames.length > 0 || !fs.existsSync(writePath)) {
    atomicWriteFileSync(writePath, JSON.stringify(existing, null, 2) + "\n");
  }

  return mergedNames;
}
