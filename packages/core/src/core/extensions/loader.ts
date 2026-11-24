import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expandHome } from "../../utils/paths.ts";
import { getSmcpDir } from "../state/paths.ts";

export interface LoadUserExtensionsOptions {
  cwd?: string;
  smcpDir?: string;
  disabled?: boolean;
  json?: boolean;
  /**
   * Load extensions from the current project (./smcp.config.*, ./.smcp/plugins/).
   * Off by default: running smcp inside a cloned repository must not execute that
   * repository's code. Also enabled by SMCP_ALLOW_LOCAL_EXTENSIONS=1.
   */
  allowLocal?: boolean;
}

function isExtensionFile(filename: string): boolean {
  if (
    filename.endsWith(".d.ts") ||
    filename.endsWith(".test.ts") ||
    filename.endsWith(".spec.ts") ||
    filename.endsWith(".test.js") ||
    filename.endsWith(".spec.js") ||
    filename.endsWith(".test.mjs") ||
    filename.endsWith(".spec.mjs") ||
    filename.endsWith(".test.cjs") ||
    filename.endsWith(".spec.cjs")
  ) {
    return false;
  }

  return (
    filename.endsWith(".js") ||
    filename.endsWith(".mjs") ||
    filename.endsWith(".cjs") ||
    filename.endsWith(".ts")
  );
}

export async function loadUserExtensions(
  options?: LoadUserExtensionsOptions
): Promise<string[]> {
  if (
    process.env.SMCP_DISABLE_EXTENSIONS === "1" ||
    process.env.SMCP_DISABLE_EXTENSIONS === "true" ||
    options?.disabled
  ) {
    return [];
  }

  const rawCwd = options?.cwd || process.cwd();
  const rawSmcpDir = options?.smcpDir || getSmcpDir();

  const cwd = path.resolve(expandHome(rawCwd));
  const smcpDir = path.resolve(expandHome(rawSmcpDir));

  const allowLocal =
    options?.allowLocal === true ||
    process.env.SMCP_ALLOW_LOCAL_EXTENSIONS === "1" ||
    process.env.SMCP_ALLOW_LOCAL_EXTENSIONS === "true";

  const filesToLoad: string[] = [];
  const skippedLocal: string[] = [];
  const seenPaths = new Set<string>();

  function addCandidate(filePath: string, local = false): void {
    if (local && !allowLocal) {
      try {
        if (fs.statSync(path.resolve(filePath)).isFile()) {
          skippedLocal.push(path.resolve(filePath));
        }
      } catch {
        // Ignore filesystem access errors
      }
      return;
    }
    const resolved = path.resolve(filePath);
    if (seenPaths.has(resolved)) return;

    try {
      if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        if (stat.isFile()) {
          seenPaths.add(resolved);
          filesToLoad.push(resolved);
        }
      }
    } catch {
      // Ignore filesystem access errors
    }
  }

  // 1. Global plugins directory: path.join(smcpDir || getSmcpDir(), "plugins")
  const globalPluginsDir = path.join(smcpDir, "plugins");
  try {
    if (fs.existsSync(globalPluginsDir)) {
      const stat = fs.statSync(globalPluginsDir);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(globalPluginsDir).sort();
        for (const entry of entries) {
          if (isExtensionFile(entry)) {
            addCandidate(path.join(globalPluginsDir, entry));
          }
        }
      }
    }
  } catch {
    // Ignore global plugins directory errors
  }

  // 2. Local directory config: ./smcp.config.js, ./smcp.config.mjs, ./smcp.config.cjs, ./smcp.config.ts
  const configNames = ["smcp.config.js", "smcp.config.mjs", "smcp.config.cjs", "smcp.config.ts"];
  for (const configName of configNames) {
    const fullPath = path.resolve(cwd, configName);
    if (fs.existsSync(fullPath)) {
      addCandidate(fullPath, true);
      break;
    }
  }

  // 3. Local plugins directory: ./.smcp/plugins/
  const localPluginsDir = path.resolve(cwd, ".smcp", "plugins");
  try {
    if (fs.existsSync(localPluginsDir)) {
      const stat = fs.statSync(localPluginsDir);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(localPluginsDir).sort();
        for (const entry of entries) {
          if (isExtensionFile(entry)) {
            addCandidate(path.join(localPluginsDir, entry), true);
          }
        }
      }
    }
  } catch {
    // Ignore local plugins directory errors
  }

  const isJsonMode = Boolean(
    (typeof process !== "undefined" && process.argv && process.argv.includes("--json")) ||
    options?.json
  );

  if (skippedLocal.length > 0 && !isJsonMode) {
    console.warn(
      `Warning: skipped ${skippedLocal.length} project-local extension file(s) (${skippedLocal
        .map((f) => path.relative(cwd, f) || f)
        .join(", ")}). They run arbitrary code, so they only load with --allow-local-extensions or SMCP_ALLOW_LOCAL_EXTENSIONS=1.`
    );
  }

  const loadedPaths: string[] = [];

  for (const fullPath of filesToLoad) {
    try {
      const fileUrl = pathToFileURL(fullPath).href;
      const mod = await import(fileUrl);
      if (typeof mod?.default === "function" && !mod.default.toString().startsWith("class ")) {
        try {
          await mod.default();
        } catch (err) {
          if (!isJsonMode) {
            console.warn(
              `Warning: Failed to execute extension from ${fullPath}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
          // Script failed during default execution
          continue;
        }
      }
      loadedPaths.push(fullPath);
    } catch (err) {
      if (!isJsonMode) {
        console.warn(
          `Warning: Failed to load extension from ${fullPath}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  return loadedPaths;
}
