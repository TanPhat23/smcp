import fs from "node:fs";
import path from "node:path";
import type { McpServerConfig } from "../types.ts";
import { expandHome } from "../utils/paths.ts";
import { atomicWriteFileSync } from "./state.ts";

function isPrototypePollutionKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function isStrictlyInside(baseDir: string, targetPath: string): boolean {
  const rel = path.relative(baseDir, targetPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return false;
  }
  const normalizedBase = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  return targetPath.startsWith(normalizedBase);
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
  let writePath = resolvedPath;

  let config: Record<string, unknown> = {};
  if (fs.existsSync(resolvedPath)) {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`Target path is not a file: ${resolvedPath}`);
    }
    writePath = fs.realpathSync(resolvedPath);

    let raw = "";
    try {
      raw = fs.readFileSync(writePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        config = parsed;
      }
    } catch {
      if (raw.trim().length > 0) {
        const backupPath = `${resolvedPath}.bak.${Date.now()}`;
        fs.writeFileSync(backupPath, raw, "utf8");
        console.warn(`Warning: Corrupted config at ${resolvedPath} was backed up to ${backupPath}`);
      }
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

  if (newServers && typeof newServers === "object" && !Array.isArray(newServers)) {
    for (const [serverName, serverConfig] of Object.entries(newServers)) {
      if (isPrototypePollutionKey(serverName)) {
        continue;
      }
      serversMap[serverName] = serverConfig;
    }
  }

  const content = JSON.stringify(config, null, 2) + "\n";
  atomicWriteFileSync(writePath, content);
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
  let canonicalBaseDir = fs.existsSync(resolvedBaseDir)
    ? fs.realpathSync(resolvedBaseDir)
    : resolvedBaseDir;

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

  let targetExists = false;
  try {
    fs.lstatSync(targetDir);
    targetExists = true;
  } catch {
    targetExists = false;
  }

  if (targetExists) {
    try {
      const realTargetDir = fs.realpathSync(targetDir);
      if (!isStrictlyInside(canonicalBaseDir, realTargetDir)) {
        throw new Error(`Directory traversal detected in skill name: ${skillName}`);
      }
    } catch (err: any) {
      if (err.message?.includes("Directory traversal")) {
        throw err;
      }
      throw new Error(`Directory traversal detected in skill name: ${skillName}`);
    }
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (fs.existsSync(resolvedBaseDir)) {
    canonicalBaseDir = fs.realpathSync(resolvedBaseDir);
  }

  if (files && typeof files === "object" && !Array.isArray(files)) {
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

      const segments = relFile.split(/[/\\]/).filter(Boolean);
      let currentCheckPath = targetDir;
      for (const segment of segments) {
        currentCheckPath = path.join(currentCheckPath, segment);
        let exists = false;
        try {
          fs.lstatSync(currentCheckPath);
          exists = true;
        } catch {
          exists = false;
        }

        if (exists) {
          try {
            const realCurrent = fs.realpathSync(currentCheckPath);
            if (!isStrictlyInside(canonicalBaseDir, realCurrent)) {
              throw new Error(`Directory traversal detected in filename: ${filename}`);
            }
          } catch (err: any) {
            if (err.message?.includes("Directory traversal")) {
              throw err;
            }
            throw new Error(`Directory traversal detected in filename: ${filename}`);
          }
        }
      }

      const parentDir = path.dirname(resolvedFilePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      if (fs.existsSync(parentDir)) {
        const realParent = fs.realpathSync(parentDir);
        if (!isStrictlyInside(canonicalBaseDir, realParent)) {
          throw new Error(`Directory traversal detected in filename: ${filename}`);
        }
      }

      const fileContent = typeof content === "string" ? content : String(content ?? "");
      atomicWriteFileSync(resolvedFilePath, fileContent);
    }
  }
}
