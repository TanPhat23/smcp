import fs from "node:fs";
import path from "node:path";
import {
  containsNullByte,
  isPrototypePollutionKey,
  isStrictlyInside,
  isWindowsReservedName,
  normalizeMcpServerConfig,
  stripJsonComments,
  type AgentEntry,
  type McpServerConfig,
  type PluginEntry,
  type RuleEntry,
  type SkillEntry
} from "@tanphat/smcp-core";

function isSafeEntryName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !name.includes("..") &&
    !containsNullByte(name) &&
    !path.isAbsolute(name) &&
    !isPrototypePollutionKey(name) &&
    !isWindowsReservedName(name)
  );
}

function isSafeRelFilePath(relName: string): boolean {
  return (
    Boolean(relName) &&
    !relName.includes("..") &&
    !path.isAbsolute(relName) &&
    !relName.startsWith("/") &&
    !relName.startsWith("\\") &&
    !containsNullByte(relName) &&
    !isPrototypePollutionKey(relName) &&
    !isWindowsReservedName(relName)
  );
}

function copyInlineFiles(inlineFiles: Record<string, string>, dest: Record<string, string>): void {
  for (const [fn, cnt] of Object.entries(inlineFiles)) {
    if (isSafeRelFilePath(fn)) {
      dest[fn] = cnt;
    }
  }
}

function collectRawFilesByPrefixes(
  rawFiles: Record<string, string>,
  prefixes: string[],
  dest: Record<string, string>
): boolean {
  for (const prefix of prefixes) {
    for (const [fname, content] of Object.entries(rawFiles)) {
      if (fname.startsWith(prefix)) {
        const relName = fname.slice(prefix.length);
        if (isSafeRelFilePath(relName)) {
          dest[relName] = content;
        }
      }
    }
    if (Object.keys(dest).length > 0) {
      return true;
    }
  }
  return false;
}

function collectLocalBundleDirFiles(
  localDir: string,
  candidateSubDirs: string[],
  dest: Record<string, string>
): boolean {
  if (!fs.existsSync(localDir)) return false;
  const resolvedLocalDir = path.resolve(localDir);

  for (const cDir of candidateSubDirs) {
    const resolvedCDir = path.resolve(cDir);
    if (!isStrictlyInside(resolvedLocalDir, resolvedCDir)) {
      continue;
    }
    if (fs.existsSync(resolvedCDir) && fs.statSync(resolvedCDir).isDirectory()) {
      const canonicalCDir = fs.realpathSync(resolvedCDir);
      if (!isStrictlyInside(resolvedLocalDir, canonicalCDir) && canonicalCDir !== resolvedLocalDir) {
        continue;
      }
      const allEntries = fs.readdirSync(canonicalCDir, { recursive: true, encoding: "utf8" });
      for (const entry of allEntries) {
        if (typeof entry !== "string") continue;
        const full = path.join(canonicalCDir, entry);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          const realFull = fs.realpathSync(full);
          if (!isStrictlyInside(canonicalCDir, realFull)) {
            continue;
          }
          const rel = path.relative(canonicalCDir, full).replaceAll("\\", "/");
          if (!isSafeRelFilePath(rel)) {
            continue;
          }
          dest[rel] = fs.readFileSync(full, "utf8");
        }
      }
      if (Object.keys(dest).length > 0) {
        return true;
      }
    }
  }
  return false;
}

export function extractSkillFiles(
  skill: SkillEntry,
  rawFiles?: Record<string, string>,
  localDir?: string
): Record<string, string> {
  const filesToInstall: Record<string, string> = {};

  if (!skill || !isSafeEntryName(skill.name)) {
    return filesToInstall;
  }

  // 1. Check skill.files from manifest
  if (skill.files && typeof skill.files === "object" && !Array.isArray(skill.files)) {
    copyInlineFiles(skill.files, filesToInstall);
    if (Object.keys(filesToInstall).length > 0) {
      return filesToInstall;
    }
  }

  // 2. Check repo slash path first, then flattened Gist rawFiles prefix
  if (
    rawFiles &&
    collectRawFilesByPrefixes(
      rawFiles,
      [`skills/${skill.name}/`, `skills_${skill.name}_`],
      filesToInstall
    )
  ) {
    return filesToInstall;
  }

  // 3. Check localDir/skills/<skill.name> or localDir/<skill.name>
  if (localDir) {
    const resolvedLocalDir = path.resolve(localDir);
    if (
      collectLocalBundleDirFiles(
        localDir,
        [path.join(resolvedLocalDir, "skills", skill.name), path.join(resolvedLocalDir, skill.name)],
        filesToInstall
      )
    ) {
      return filesToInstall;
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
  const pName = typeof plugin === "string" ? plugin : plugin?.name;
  const filesToInstall: Record<string, string> = {};

  if (!isSafeEntryName(pName)) {
    return filesToInstall;
  }

  if (typeof plugin === "object" && plugin.files && Object.keys(plugin.files).length > 0) {
    copyInlineFiles(plugin.files, filesToInstall);
    if (Object.keys(filesToInstall).length > 0) {
      return filesToInstall;
    }
  }

  if (rawFiles) {
    const sanitizedName = pName.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (
      collectRawFilesByPrefixes(
        rawFiles,
        [`plugins/${pName}/`, `plugins_${sanitizedName}_`],
        filesToInstall
      )
    ) {
      return filesToInstall;
    }
  }

  if (localDir) {
    const resolvedLocalDir = path.resolve(localDir);
    if (
      collectLocalBundleDirFiles(
        localDir,
        [path.join(resolvedLocalDir, "plugins", pName), path.join(resolvedLocalDir, pName)],
        filesToInstall
      )
    ) {
      return filesToInstall;
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
    const strippedPath = normalizedPath.replace(/^\.\//, "");
    if (strippedPath && rawFiles[strippedPath]) {
      return rawFiles[strippedPath];
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

export function extractRuleContent(
  rule: RuleEntry,
  rawFiles?: Record<string, string>,
  localDir?: string
): string {
  if (!rule || !isSafeEntryName(rule.name)) return "";
  if (typeof rule.content === "string" && rule.content.length > 0) {
    return rule.content;
  }
  if (rule.files) {
    const first = Object.values(rule.files)[0];
    if (typeof first === "string") return first;
  }
  if (rawFiles) {
    for (const candidate of [
      rule.path,
      `rules/${rule.name}.md`,
      `rules/${rule.name}`,
      `rules_${rule.name}.md`,
      `rules_${rule.name}`
    ]) {
      if (candidate && rawFiles[candidate]) {
        return rawFiles[candidate];
      }
    }
  }
  if (localDir && fs.existsSync(localDir)) {
    const resolvedLocal = path.resolve(localDir);
    const candidates = [
      ...(rule.path ? [path.resolve(resolvedLocal, rule.path)] : []),
      path.resolve(resolvedLocal, "rules", `${rule.name}.md`),
      path.resolve(resolvedLocal, `${rule.name}.md`)
    ];
    for (const cand of candidates) {
      if (!isStrictlyInside(resolvedLocal, cand)) continue;
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        try {
          const canonical = fs.realpathSync(cand);
          if (isStrictlyInside(fs.realpathSync(resolvedLocal), canonical)) {
            return fs.readFileSync(canonical, "utf8");
          }
        } catch {
          // ignore read error
        }
      }
    }
  }
  return "";
}

export interface ExtractedDirectoryPluginComponents {
  mcpServers: Record<string, McpServerConfig>;
  skills: Record<string, Record<string, string>>;
  agents: Array<{ name: string; content: string }>;
}

/**
 * Extracts MCP servers, skills, and subagents bundled inside a directory-format plugin
 * so they can also be installed into agents that don't natively load directory plugins.
 */
export function extractDirectoryPluginComponents(
  files: Record<string, string>
): ExtractedDirectoryPluginComponents {
  const mcpServers: Record<string, McpServerConfig> = {};
  const skills: Record<string, Record<string, string>> = {};
  const agents: Array<{ name: string; content: string }> = [];
  const seenAgentNames = new Set<string>();

  for (const mcpFile of ["mcp_config.json", "mcp.json", "gemini-extension.json"]) {
    const rawMcp = files[mcpFile];
    if (typeof rawMcp !== "string") continue;
    try {
      const parsed: unknown = JSON.parse(stripJsonComments(rawMcp));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const serversRaw = (parsed as Record<string, unknown>).mcpServers;
      if (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw)) continue;
      for (const [sName, sVal] of Object.entries(serversRaw)) {
        if (isPrototypePollutionKey(sName) || mcpServers[sName]) continue;
        if (sVal && typeof sVal === "object" && !Array.isArray(sVal)) {
          mcpServers[sName] = normalizeMcpServerConfig(sVal as Record<string, unknown>);
        }
      }
    } catch {
      // Ignore malformed plugin mcp config
    }
  }

  for (const [relPath, content] of Object.entries(files)) {
    const normalized = relPath.replaceAll("\\", "/");
    if (normalized.startsWith("skills/")) {
      const parts = normalized.split("/");
      if (parts.length >= 3) {
        const skillName = parts[1];
        const fileRel = parts.slice(2).join("/");
        if (isSafeEntryName(skillName) && isSafeRelFilePath(fileRel)) {
          skills[skillName] = skills[skillName] || {};
          skills[skillName][fileRel] = content;
        }
      }
    } else if (normalized.startsWith("agents/") && normalized.toLowerCase().endsWith(".md")) {
      const parts = normalized.split("/");
      let agentName = "";
      if (parts.length === 2) {
        agentName = parts[1].replace(/\.md$/i, "");
      } else if (parts.length === 3 && parts[2].toLowerCase() === "agent.md") {
        agentName = parts[1];
      }
      if (agentName && isSafeEntryName(agentName) && !seenAgentNames.has(agentName)) {
        seenAgentNames.add(agentName);
        agents.push({ name: agentName, content });
      }
    }
  }

  return { mcpServers, skills, agents };
}
