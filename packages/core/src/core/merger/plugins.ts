import fs from "node:fs";
import path from "node:path";
import type { PluginEntry } from "../../types/index.ts";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { stripJsonComments } from "../agents/index.ts";
import { isStrictlyInside } from "./helpers.ts";

export function mergePluginsIntoFile(
  filePath: string,
  plugins: (string | PluginEntry)[],
  key = "plugin",
  format: "array" | "map" = "array"
): void {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Invalid filePath: must be a non-empty string");
  }
  if (!key || typeof key !== "string" || isPrototypePollutionKey(key)) {
    throw new Error(`Invalid key: ${key}`);
  }

  const resolvedPath = expandHome(filePath);
  let content = "";
  if (fs.existsSync(resolvedPath)) {
    try {
      content = fs.readFileSync(resolvedPath, "utf8");
    } catch {
      content = "";
    }
  }

  const pluginNames: string[] = [];
  for (const p of plugins) {
    if (typeof p === "string" && p.trim()) {
      pluginNames.push(p.trim());
    } else if (p && typeof p === "object" && "name" in p && typeof p.name === "string" && p.name.trim()) {
      pluginNames.push(p.name.trim());
    }
  }

  let parsed: Record<string, unknown> = {};
  if (content.trim()) {
    try {
      const res = JSON.parse(stripJsonComments(content));
      if (res && typeof res === "object" && !Array.isArray(res)) {
        parsed = res;
      }
    } catch {
      const backupPath = `${resolvedPath}.bak.${Date.now()}`;
      fs.writeFileSync(backupPath, content, "utf8");
      console.warn(`Warning: Corrupted config at ${resolvedPath} was backed up to ${backupPath}`);
      parsed = {};
    }
  }

  if (Object.hasOwn(parsed, "__proto__")) delete (parsed as any)["__proto__"];
  if (Object.hasOwn(parsed, "constructor")) delete (parsed as any)["constructor"];
  if (Object.hasOwn(parsed, "prototype")) delete (parsed as any)["prototype"];

  if (format === "array") {
    const actualKey =
      Array.isArray(parsed[key])
        ? key
        : Array.isArray(parsed.plugins)
        ? "plugins"
        : Array.isArray(parsed.plugin)
        ? "plugin"
        : key;

    const existingList = Array.isArray(parsed[actualKey]) ? (parsed[actualKey] as string[]) : [];
    const mergedList = [...existingList];
    for (const name of pluginNames) {
      if (!isPrototypePollutionKey(name) && !mergedList.includes(name)) {
        mergedList.push(name);
      }
    }

    parsed[actualKey] = mergedList;
    atomicWriteFileSync(resolvedPath, JSON.stringify(parsed, null, 2) + "\n");
  } else {
    const existingMap =
      parsed[key] && typeof parsed[key] === "object" && !Array.isArray(parsed[key])
        ? (parsed[key] as Record<string, boolean>)
        : {};

    if (Object.hasOwn(existingMap, "__proto__")) delete (existingMap as any)["__proto__"];
    if (Object.hasOwn(existingMap, "constructor")) delete (existingMap as any)["constructor"];
    if (Object.hasOwn(existingMap, "prototype")) delete (existingMap as any)["prototype"];

    const mergedMap = { ...existingMap };
    for (const name of pluginNames) {
      if (!isPrototypePollutionKey(name)) {
        mergedMap[name] = true;
      }
    }

    parsed[key] = mergedMap;
    atomicWriteFileSync(resolvedPath, JSON.stringify(parsed, null, 2) + "\n");
  }
}

export function installPluginFiles(
  targetDir: string,
  pluginName: string,
  files: Record<string, string>
): void {
  if (!targetDir || typeof targetDir !== "string") {
    throw new Error("Invalid targetDir: must be a non-empty string");
  }

  if (
    !pluginName ||
    typeof pluginName !== "string" ||
    pluginName.trim() === "" ||
    pluginName === "." ||
    pluginName === ".." ||
    pluginName.includes("..") ||
    path.isAbsolute(pluginName) ||
    isPrototypePollutionKey(pluginName)
  ) {
    throw new Error(`Directory traversal attempt or invalid plugin name: ${pluginName}`);
  }

  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return;
  }

  const safeTargetDir = path.resolve(expandHome(targetDir));
  if (!fs.existsSync(safeTargetDir)) {
    fs.mkdirSync(safeTargetDir, { recursive: true });
  }

  const canonicalBaseDir = fs.existsSync(safeTargetDir)
    ? fs.realpathSync(safeTargetDir)
    : safeTargetDir;

  const cleanPluginName = path.basename(pluginName);
  const targetPluginDir =
    cleanPluginName.endsWith(".ts") || cleanPluginName.endsWith(".js")
      ? safeTargetDir
      : path.resolve(safeTargetDir, cleanPluginName);

  if (fs.existsSync(targetPluginDir)) {
    const realTargetDir = fs.realpathSync(targetPluginDir);
    if (!isStrictlyInside(canonicalBaseDir, realTargetDir) && realTargetDir !== canonicalBaseDir) {
      throw new Error(`Directory traversal or symlink escape detected in plugin: ${pluginName}`);
    }
  }

  for (const [relPath, content] of Object.entries(files)) {
    if (isPrototypePollutionKey(relPath)) continue;

    const normalizedRel = relPath.replaceAll("\\", "/");
    if (
      normalizedRel.includes("..") ||
      path.isAbsolute(normalizedRel) ||
      normalizedRel.startsWith("/") ||
      normalizedRel.startsWith("\\")
    ) {
      throw new Error(`Directory traversal detected in plugin file: ${relPath}`);
    }

    const targetFile =
      cleanPluginName.endsWith(".ts") || cleanPluginName.endsWith(".js")
        ? path.resolve(safeTargetDir, cleanPluginName)
        : path.resolve(targetPluginDir, normalizedRel);

    const checkRel = path.relative(safeTargetDir, targetFile);
    if (!checkRel || checkRel.startsWith("..") || path.isAbsolute(checkRel)) {
      throw new Error(`Directory traversal detected in plugin file: ${relPath}`);
    }

    const parentDir = path.dirname(targetFile);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const realParent = fs.realpathSync(parentDir);
    if (!isStrictlyInside(canonicalBaseDir, realParent) && realParent !== canonicalBaseDir) {
      throw new Error(`Directory traversal or symlink escape detected in plugin file: ${relPath}`);
    }

    if (fs.existsSync(targetFile)) {
      const realTarget = fs.realpathSync(targetFile);
      if (!isStrictlyInside(canonicalBaseDir, realTarget)) {
        throw new Error(`Directory traversal or symlink escape detected in plugin file: ${relPath}`);
      }
    }

    const fileContent = typeof content === "string" ? content : String(content ?? "");
    atomicWriteFileSync(targetFile, fileContent);
  }
}
