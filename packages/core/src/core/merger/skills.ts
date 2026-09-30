import fs from "node:fs";
import path from "node:path";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import { expandHome } from "../../utils/paths.ts";
import {
  containsNullByte,
  isPrototypePollutionKey,
  isWindowsReservedName
} from "../../utils/security.ts";
import { isStrictlyInside } from "./helpers.ts";

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
    containsNullByte(skillName) ||
    path.isAbsolute(skillName) ||
    isPrototypePollutionKey(skillName) ||
    isWindowsReservedName(skillName)
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

      if (containsNullByte(filename) || isWindowsReservedName(filename)) {
        throw new Error(`Directory traversal or dangerous filename detected: ${filename}`);
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
