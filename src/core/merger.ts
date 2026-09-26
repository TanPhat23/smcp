import fs from "node:fs";
import path from "node:path";
import type { McpServerConfig } from "../types.ts";
import { expandHome } from "../utils/paths.ts";
import { atomicWriteFileSync } from "./state.ts";

function isPrototypePollutionKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

export function mergeMcpServersIntoFile(
  filePath: string,
  newServers: Record<string, McpServerConfig>,
  mcpKey = "mcpServers"
): void {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Invalid filePath: must be a non-empty string");
  }

  if (!mcpKey || typeof mcpKey !== "string" || isPrototypePollutionKey(mcpKey)) {
    throw new Error(`Invalid mcpKey: ${mcpKey}`);
  }

  const resolvedPath = expandHome(filePath);

  let config: Record<string, unknown> = {};
  if (fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        config = parsed;
      }
    } catch {
      config = {};
    }
  }

  if (Object.hasOwn(config, "__proto__")) delete (config as any)["__proto__"];
  if (Object.hasOwn(config, "constructor")) delete (config as any)["constructor"];
  if (Object.hasOwn(config, "prototype")) delete (config as any)["prototype"];

  const existingServers = config[mcpKey];
  let serversMap: Record<string, unknown>;

  if (
    existingServers &&
    typeof existingServers === "object" &&
    !Array.isArray(existingServers)
  ) {
    serversMap = existingServers as Record<string, unknown>;
    if (Object.hasOwn(serversMap, "__proto__")) delete (serversMap as any)["__proto__"];
    if (Object.hasOwn(serversMap, "constructor")) delete (serversMap as any)["constructor"];
    if (Object.hasOwn(serversMap, "prototype")) delete (serversMap as any)["prototype"];
  } else {
    serversMap = {};
    config[mcpKey] = serversMap;
  }

  if (newServers && typeof newServers === "object") {
    for (const [serverName, serverConfig] of Object.entries(newServers)) {
      if (isPrototypePollutionKey(serverName)) {
        continue;
      }
      serversMap[serverName] = serverConfig;
    }
  }

  const content = JSON.stringify(config, null, 2) + "\n";
  atomicWriteFileSync(resolvedPath, content);
}

export function installSkillFiles(
  skillsBaseDir: string,
  skillName: string,
  files: Record<string, string>
): void {
  if (!skillsBaseDir || typeof skillsBaseDir !== "string") {
    throw new Error("Invalid skillsBaseDir: must be a non-empty string");
  }

  if (
    !skillName ||
    typeof skillName !== "string" ||
    skillName.trim() === "" ||
    skillName === "." ||
    skillName === ".." ||
    skillName.includes("/") ||
    skillName.includes("\\") ||
    skillName.includes("..") ||
    path.isAbsolute(skillName) ||
    isPrototypePollutionKey(skillName)
  ) {
    throw new Error(`Directory traversal attempt or invalid skill name: ${skillName}`);
  }

  const resolvedBaseDir = path.resolve(expandHome(skillsBaseDir));
  const targetDir = path.resolve(resolvedBaseDir, skillName);
  const relDir = path.relative(resolvedBaseDir, targetDir);

  if (
    !relDir ||
    relDir.startsWith("..") ||
    path.isAbsolute(relDir) ||
    targetDir === resolvedBaseDir ||
    !targetDir.startsWith(resolvedBaseDir + path.sep)
  ) {
    throw new Error(`Directory traversal detected in skill name: ${skillName}`);
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (files && typeof files === "object") {
    for (const [filename, content] of Object.entries(files)) {
      if (isPrototypePollutionKey(filename)) {
        continue;
      }

      const normalizedFilename = filename.replaceAll("\\", "/");
      const resolvedFilePath = path.resolve(targetDir, normalizedFilename);
      const relFile = path.relative(targetDir, resolvedFilePath);

      if (
        !relFile ||
        relFile.startsWith("..") ||
        path.isAbsolute(relFile) ||
        resolvedFilePath === targetDir ||
        !resolvedFilePath.startsWith(targetDir + path.sep)
      ) {
        throw new Error(`Directory traversal detected in filename: ${filename}`);
      }

      const parentDir = path.dirname(resolvedFilePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const fileContent = typeof content === "string" ? content : String(content ?? "");
      atomicWriteFileSync(resolvedFilePath, fileContent);
    }
  }
}
