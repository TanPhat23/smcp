import fs from "node:fs";
import path from "node:path";
import type { PluginObjectEntry } from "../../types/index.ts";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { stripJsonComments } from "./jsonc.ts";

export function readInstalledPlugins(
  configPath: string,
  key = "plugin",
  format: "array" | "map" = "array",
  dirPaths?: string[]
): PluginObjectEntry[] {
  if (!configPath) return [];
  try {
    const resolvedPath = expandHome(configPath);
    if (!fs.existsSync(resolvedPath)) return [];
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) return [];

    const raw = fs.readFileSync(resolvedPath, "utf8");
    const json = JSON.parse(stripJsonComments(raw));
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return [];
    }

    const plugins: PluginObjectEntry[] = [];

    if (format === "array") {
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
          let resolvedLocalFile: string | undefined = undefined;
          if (
            trimmed.startsWith("./") ||
            trimmed.startsWith("../") ||
            path.isAbsolute(trimmed) ||
            trimmed.startsWith("~/")
          ) {
            const baseDir = path.dirname(resolvedPath);
            let candidate: string;
            if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
              candidate = expandHome(trimmed);
            } else if (path.isAbsolute(trimmed)) {
              candidate = trimmed;
            } else {
              candidate = path.resolve(baseDir, trimmed);
            }
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
              resolvedLocalFile = candidate;
            }
          }

          plugins.push({
            name: trimmed,
            targetAgent: "opencode",
            path: resolvedLocalFile
          });
        } else if (item && typeof item === "object" && "name" in item && typeof (item as any).name === "string") {
          plugins.push(item as PluginObjectEntry);
        }
      }

      if (dirPaths && Array.isArray(dirPaths)) {
        for (const dir of dirPaths) {
          try {
            const resolvedDir = expandHome(dir);
            if (fs.existsSync(resolvedDir) && fs.statSync(resolvedDir).isDirectory()) {
              const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
              for (const entry of entries) {
                if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
                  const fullPath = path.join(resolvedDir, entry.name);
                  if (!plugins.some((p) => p.name === entry.name || p.path === fullPath)) {
                    plugins.push({
                      name: entry.name,
                      targetAgent: "opencode",
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
                      targetAgent: "opencode",
                      path: subDir
                    });
                  }
                }
              }
            }
          } catch {
            // ignore directory access error
          }
        }
      }
    } else if (format === "map") {
      const mapObj = (json as Record<string, unknown>)[key] || (json as Record<string, unknown>).enabledPlugins || {};
      if (mapObj && typeof mapObj === "object" && !Array.isArray(mapObj)) {
        for (const [pName, enabled] of Object.entries(mapObj)) {
          if (isPrototypePollutionKey(pName)) continue;
          if (Boolean(enabled)) {
            plugins.push({
              name: pName,
              targetAgent: "claude-code"
            });
          }
        }
      }
    }

    return plugins;
  } catch {
    return [];
  }
}
