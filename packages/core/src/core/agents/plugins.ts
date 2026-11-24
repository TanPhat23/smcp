import fs from "node:fs";
import path from "node:path";
import type { PluginObjectEntry } from "../../types/index.ts";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { stripJsonComments } from "./jsonc.ts";

export type PluginFormat = "array" | "map" | "directory";

const AGY_PLUGIN_MANIFEST_REL_PATHS = [
  "plugin.json",
  path.join(".antigravity-plugin", "plugin.json"),
  path.join(".gemini-plugin", "plugin.json"),
  "gemini-extension.json"
];

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === "object" && !Array.isArray(val));
}

function readJsonRecordSafe(filePath: string): Record<string, unknown> | null {
  if (!filePath) return null;
  try {
    const resolvedPath = expandHome(filePath);
    if (!fs.existsSync(resolvedPath)) return null;
    if (!fs.statSync(resolvedPath).isFile()) return null;
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const parsed: unknown = JSON.parse(stripJsonComments(raw));
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveLocalPluginPath(trimmed: string, resolvedConfigPath: string): string | undefined {
  if (
    !trimmed.startsWith("./") &&
    !trimmed.startsWith("../") &&
    !path.isAbsolute(trimmed) &&
    !trimmed.startsWith("~/")
  ) {
    return undefined;
  }
  const baseDir = path.dirname(resolvedConfigPath);
  const candidate =
    trimmed.startsWith("~/") || trimmed.startsWith("~\\")
      ? expandHome(trimmed)
      : path.isAbsolute(trimmed)
      ? trimmed
      : path.resolve(baseDir, trimmed);

  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : undefined;
}

function readArrayPlugins(
  json: Record<string, unknown>,
  resolvedConfigPath: string,
  key: string,
  dirPaths: string[] | undefined,
  targetAgent: string
): PluginObjectEntry[] {
  const plugins: PluginObjectEntry[] = [];
  let rawList: unknown[] = [];
  if (Array.isArray(json[key])) {
    rawList = json[key];
  } else if (Array.isArray(json.plugins)) {
    rawList = json.plugins;
  } else if (Array.isArray(json.plugin)) {
    rawList = json.plugin;
  }

  for (const item of rawList) {
    if (typeof item === "string" && item.trim()) {
      const trimmed = item.trim();
      plugins.push({
        name: trimmed,
        targetAgent,
        path: resolveLocalPluginPath(trimmed, resolvedConfigPath)
      });
    } else if (isPlainRecord(item) && typeof item.name === "string") {
      plugins.push({
        name: item.name,
        targetAgent: typeof item.targetAgent === "string" ? item.targetAgent : undefined,
        description: typeof item.description === "string" ? item.description : undefined,
        path: typeof item.path === "string" ? item.path : undefined
      });
    }
  }

  if (dirPaths && Array.isArray(dirPaths)) {
    for (const dir of dirPaths) {
      try {
        const resolvedDir = expandHome(dir);
        if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) continue;
        const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
            const fullPath = path.join(resolvedDir, entry.name);
            if (!plugins.some((p) => p.name === entry.name || p.path === fullPath)) {
              plugins.push({
                name: entry.name,
                targetAgent,
                path: fullPath
              });
            }
          } else if (entry.isDirectory()) {
            const subDir = path.join(resolvedDir, entry.name);
            const hasEntry =
              fs.existsSync(path.join(subDir, "index.ts")) ||
              fs.existsSync(path.join(subDir, "index.js")) ||
              fs.existsSync(path.join(subDir, "package.json"));
            if (hasEntry && !plugins.some((p) => p.name === entry.name)) {
              plugins.push({
                name: entry.name,
                targetAgent,
                path: subDir
              });
            }
          }
        }
      } catch {
        // ignore directory access error
      }
    }
  }

  return plugins;
}

function readMapPlugins(
  json: Record<string, unknown>,
  key: string,
  targetAgent: string
): PluginObjectEntry[] {
  const plugins: PluginObjectEntry[] = [];
  const candidateMap = json[key] ?? json.enabledPlugins;
  if (!isPlainRecord(candidateMap)) {
    return plugins;
  }

  for (const [pName, enabled] of Object.entries(candidateMap)) {
    if (isPrototypePollutionKey(pName)) continue;
    const isEnabled = isPlainRecord(enabled)
      ? enabled.enabled !== false
      : Boolean(enabled);
    if (isEnabled) {
      plugins.push({
        name: pName,
        targetAgent
      });
    }
  }

  return plugins;
}

function findPluginManifest(subDir: string): Record<string, unknown> | null {
  for (const relPath of AGY_PLUGIN_MANIFEST_REL_PATHS) {
    const manifestPath = path.join(subDir, relPath);
    const parsed = readJsonRecordSafe(manifestPath);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function readDirectoryPlugins(
  json: Record<string, unknown> | null,
  key: string,
  dirPaths: string[] | undefined,
  targetAgent: string
): PluginObjectEntry[] {
  if (!dirPaths || !Array.isArray(dirPaths) || dirPaths.length === 0) {
    return [];
  }

  const configMap = json && isPlainRecord(json[key]) ? json[key] : {};
  const plugins: PluginObjectEntry[] = [];
  const seen = new Set<string>();

  for (const dir of dirPaths) {
    try {
      const resolvedDir = expandHome(dir);
      if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) continue;
      const entries = fs
        .readdirSync(resolvedDir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (isPrototypePollutionKey(entry.name) || seen.has(entry.name)) continue;
        const subDir = path.join(resolvedDir, entry.name);
        try {
          if (!fs.statSync(subDir).isDirectory()) continue;
        } catch {
          continue;
        }

        const manifest = findPluginManifest(subDir);
        if (!manifest) continue;

        const configOverride = Object.hasOwn(configMap, entry.name)
          ? configMap[entry.name]
          : undefined;
        const overrideEnabled = isPlainRecord(configOverride) && typeof configOverride.enabled === "boolean"
          ? configOverride.enabled
          : undefined;

        const isEnabled =
          overrideEnabled !== undefined
            ? overrideEnabled
            : manifest.disabled !== true;

        seen.add(entry.name);
        if (!isEnabled) continue;

        plugins.push({
          name: entry.name,
          targetAgent,
          description: typeof manifest.description === "string" ? manifest.description : undefined,
          path: subDir
        });
      }
    } catch {
      // ignore directory access error
    }
  }

  return plugins;
}

export function readInstalledPlugins(
  configPath: string,
  key = "plugin",
  format: PluginFormat = "array",
  dirPaths?: string[],
  agentId?: string
): PluginObjectEntry[] {
  if (format === "directory") {
    const json = readJsonRecordSafe(configPath);
    return readDirectoryPlugins(json, key, dirPaths, agentId || "agy");
  }

  if (!configPath) return [];
  const json = readJsonRecordSafe(configPath);
  if (!json) return [];

  if (format === "map") {
    return readMapPlugins(json, key, agentId || "claude-code");
  }

  const resolvedPath = expandHome(configPath);
  return readArrayPlugins(json, resolvedPath, key, dirPaths, agentId || "opencode");
}
