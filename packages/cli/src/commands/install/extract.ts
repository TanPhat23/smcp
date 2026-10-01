import fs from "node:fs";
import path from "node:path";
import {
  containsNullByte,
  isPrototypePollutionKey,
  isStrictlyInside,
  isWindowsReservedName,
  type AgentEntry,
  type PluginEntry,
  type SkillEntry
} from "@tanphat/smcp-core";

export function extractSkillFiles(
  skill: SkillEntry,
  rawFiles?: Record<string, string>,
  localDir?: string
): Record<string, string> {
  const filesToInstall: Record<string, string> = {};

  if (
    !skill ||
    !skill.name ||
    typeof skill.name !== "string" ||
    skill.name.includes("..") ||
    containsNullByte(skill.name) ||
    path.isAbsolute(skill.name) ||
    isPrototypePollutionKey(skill.name) ||
    isWindowsReservedName(skill.name)
  ) {
    return filesToInstall;
  }

  // 1. Check skill.files from manifest
  if (skill.files && typeof skill.files === "object" && !Array.isArray(skill.files)) {
    for (const [fn, cnt] of Object.entries(skill.files)) {
      if (
        fn &&
        !fn.includes("..") &&
        !path.isAbsolute(fn) &&
        !containsNullByte(fn) &&
        !isPrototypePollutionKey(fn) &&
        !isWindowsReservedName(fn)
      ) {
        filesToInstall[fn] = cnt;
      }
    }
    if (Object.keys(filesToInstall).length > 0) {
      return filesToInstall;
    }
  }

  // 2. Check Gist rawFiles with prefix skills_${skill.name}_
  if (rawFiles) {
    const prefix = `skills_${skill.name}_`;
    for (const [fname, content] of Object.entries(rawFiles)) {
      if (fname.startsWith(prefix)) {
        const relName = fname.slice(prefix.length);
        if (
          relName &&
          !relName.includes("..") &&
          !path.isAbsolute(relName) &&
          !relName.startsWith("/") &&
          !relName.startsWith("\\") &&
          !containsNullByte(relName) &&
          !isPrototypePollutionKey(relName) &&
          !isWindowsReservedName(relName)
        ) {
          filesToInstall[relName] = content;
        }
      }
    }
    if (Object.keys(filesToInstall).length > 0) {
      return filesToInstall;
    }
  }

  // 3. Check localDir/skills/<skill.name> or localDir/<skill.name>
  if (localDir && fs.existsSync(localDir)) {
    const resolvedLocalDir = path.resolve(localDir);
    const candidateDirs = [
      path.join(resolvedLocalDir, "skills", skill.name),
      path.join(resolvedLocalDir, skill.name)
    ];
    for (const cDir of candidateDirs) {
      const resolvedCDir = path.resolve(cDir);
      if (!isStrictlyInside(resolvedLocalDir, resolvedCDir)) {
        continue;
      }
      if (fs.existsSync(resolvedCDir) && fs.statSync(resolvedCDir).isDirectory()) {
        const canonicalCDir = fs.realpathSync(resolvedCDir);
        if (!isStrictlyInside(resolvedLocalDir, canonicalCDir) && canonicalCDir !== resolvedLocalDir) {
          continue;
        }
        const allEntries = fs.readdirSync(canonicalCDir, { recursive: true });
        for (const entry of allEntries) {
          const full = path.join(canonicalCDir, entry as string);
          if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            const realFull = fs.realpathSync(full);
            if (!isStrictlyInside(canonicalCDir, realFull)) {
              continue;
            }
            const rel = path.relative(canonicalCDir, full).replaceAll("\\", "/");
            if (rel.includes("..") || path.isAbsolute(rel) || isPrototypePollutionKey(rel)) {
              continue;
            }
            filesToInstall[rel] = fs.readFileSync(full, "utf8");
          }
        }
        if (Object.keys(filesToInstall).length > 0) {
          return filesToInstall;
        }
      }
    }
  }

  // 4. Fallback default SKILL.md
  if (Object.keys(filesToInstall).length === 0) {
    filesToInstall["SKILL.md"] = `# ${skill.name}\n\n${skill.description || ""}\n`;
  }

  return filesToInstall;
}

export function extractPluginFiles(
  plugin: PluginEntry,
  rawFiles?: Record<string, string>,
  localDir?: string
): Record<string, string> {
  const pName = typeof plugin === "string" ? plugin : plugin.name;
  const filesToInstall: Record<string, string> = {};

  if (
    !pName ||
    typeof pName !== "string" ||
    pName.includes("..") ||
    containsNullByte(pName) ||
    path.isAbsolute(pName) ||
    isPrototypePollutionKey(pName) ||
    isWindowsReservedName(pName)
  ) {
    return filesToInstall;
  }

  if (typeof plugin === "object" && plugin.files && Object.keys(plugin.files).length > 0) {
    for (const [fn, cnt] of Object.entries(plugin.files)) {
      if (
        fn &&
        !fn.includes("..") &&
        !path.isAbsolute(fn) &&
        !containsNullByte(fn) &&
        !isPrototypePollutionKey(fn) &&
        !isWindowsReservedName(fn)
      ) {
        filesToInstall[fn] = cnt;
      }
    }
    if (Object.keys(filesToInstall).length > 0) {
      return filesToInstall;
    }
  }

  if (rawFiles) {
    const sanitizedName = pName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const prefix = `plugins_${sanitizedName}_`;
    for (const [fname, content] of Object.entries(rawFiles)) {
      if (fname.startsWith(prefix)) {
        const relName = fname.slice(prefix.length);
        if (
          relName &&
          !relName.includes("..") &&
          !path.isAbsolute(relName) &&
          !relName.startsWith("/") &&
          !relName.startsWith("\\") &&
          !containsNullByte(relName) &&
          !isPrototypePollutionKey(relName) &&
          !isWindowsReservedName(relName)
        ) {
          filesToInstall[relName] = content;
        }
      }
    }
    if (Object.keys(filesToInstall).length > 0) {
      return filesToInstall;
    }
  }

  if (localDir && fs.existsSync(localDir)) {
    const resolvedLocalDir = path.resolve(localDir);
    const candidateDirs = [
      path.join(resolvedLocalDir, "plugins", pName),
      path.join(resolvedLocalDir, pName)
    ];
    for (const cDir of candidateDirs) {
      const resolvedCDir = path.resolve(cDir);
      if (!isStrictlyInside(resolvedLocalDir, resolvedCDir)) {
        continue;
      }
      if (fs.existsSync(resolvedCDir) && fs.statSync(resolvedCDir).isDirectory()) {
        const canonicalCDir = fs.realpathSync(resolvedCDir);
        if (!isStrictlyInside(resolvedLocalDir, canonicalCDir) && canonicalCDir !== resolvedLocalDir) {
          continue;
        }
        const allEntries = fs.readdirSync(canonicalCDir, { recursive: true });
        for (const entry of allEntries) {
          const full = path.join(canonicalCDir, entry as string);
          if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            const realFull = fs.realpathSync(full);
            if (!isStrictlyInside(canonicalCDir, realFull)) {
              continue;
            }
            const rel = path.relative(canonicalCDir, full).replaceAll("\\", "/");
            if (rel.includes("..") || path.isAbsolute(rel) || isPrototypePollutionKey(rel)) {
              continue;
            }
            filesToInstall[rel] = fs.readFileSync(full, "utf8");
          }
        }
        if (Object.keys(filesToInstall).length > 0) {
          return filesToInstall;
        }
      }
    }
  }

  return filesToInstall;
}

export function extractAgentContent(
  agent: AgentEntry,
  rawFiles?: Record<string, string>,
  localDir?: string
): string {
  if (
    !agent ||
    !agent.name ||
    typeof agent.name !== "string" ||
    agent.name.includes("..") ||
    containsNullByte(agent.name) ||
    path.isAbsolute(agent.name) ||
    isPrototypePollutionKey(agent.name) ||
    isWindowsReservedName(agent.name)
  ) {
    return "";
  }

  // 1. Check rawFiles
  if (rawFiles) {
    if (agent.path && rawFiles[agent.path]) {
      return rawFiles[agent.path];
    }
    const normalizedPath = (agent.path || "").replace(/\\/g, "/");
    if (normalizedPath && rawFiles[normalizedPath]) {
      return rawFiles[normalizedPath];
    }
    const candidates = [
      `agents/${agent.name}.md`,
      `agents/${agent.name}`,
      `${agent.name}.md`,
      `agents_${agent.name}.md`,
      `agents_${agent.name}`
    ];
    for (const c of candidates) {
      if (rawFiles[c]) {
        return rawFiles[c];
      }
    }
  }

  // 2. Check localDir
  if (localDir && fs.existsSync(localDir)) {
    const resolvedLocalDir = path.resolve(localDir);
    const candidates: string[] = [];
    if (agent.path) {
      candidates.push(path.resolve(resolvedLocalDir, agent.path));
    }
    candidates.push(
      path.resolve(resolvedLocalDir, "agents", `${agent.name}.md`),
      path.resolve(resolvedLocalDir, "agents", agent.name),
      path.resolve(resolvedLocalDir, `${agent.name}.md`)
    );

    for (const candidate of candidates) {
      if (!isStrictlyInside(resolvedLocalDir, candidate)) {
        continue;
      }
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        try {
          const canonical = fs.realpathSync(candidate);
          const canonicalLocalDir = fs.realpathSync(resolvedLocalDir);
          if (isStrictlyInside(canonicalLocalDir, canonical)) {
            return fs.readFileSync(canonical, "utf8");
          }
        } catch {
          // ignore error
        }
      }
    }
  }

  // 3. Fallback default markdown
  return `---\nname: ${agent.name}\ndescription: ${agent.description || agent.name}\nmode: ${agent.mode || "subagent"}\n---\n`;
}
