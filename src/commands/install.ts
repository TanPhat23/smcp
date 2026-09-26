import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { detectAgents, getAgentProfiles, readInstalledMcpServers } from "../core/agents.ts";
import { GitHubClient } from "../core/github.ts";
import { installSkillFiles, mergeMcpServersIntoFile } from "../core/merger.ts";
import { isSecretKey } from "../core/redactor.ts";
import { getAuthConfig } from "../core/state.ts";
import {
  ManifestSchema,
  type AgentProfile,
  type Manifest,
  type McpServerConfig,
  type RequiredEnv,
  type SkillEntry
} from "../types.ts";
import { expandHome } from "../utils/paths.ts";

export interface InstallCommandOptions {
  agents?: string[];
  env?: Record<string, string>;
  force?: boolean;
}

export function resolveActiveAgentPath(paths?: string[]): string | null {
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return null;
  }
  for (const p of paths) {
    try {
      const expanded = expandHome(p);
      if (fs.existsSync(expanded)) {
        return expanded;
      }
    } catch {
      // Ignore filesystem access errors
    }
  }
  return expandHome(paths[0]);
}

export const resolveActivePath = resolveActiveAgentPath;

export function resolveMcpServerTemplates(
  servers: Record<string, McpServerConfig>,
  envValues: Record<string, string>
): Record<string, McpServerConfig> {
  const replaceVar = (_: string, varName: string) => {
    return envValues[varName] !== undefined ? envValues[varName] : `\${${varName}}`;
  };

  const resolvedServers: Record<string, McpServerConfig> = {};
  for (const [sName, sConf] of Object.entries(servers)) {
    const resolved: McpServerConfig = { ...sConf };

    if (sConf.env) {
      const updatedEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(sConf.env)) {
        updatedEnv[k] = v.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar);
      }
      resolved.env = updatedEnv;
    }

    if (sConf.args) {
      resolved.args = sConf.args.map((arg) =>
        arg.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar)
      );
    }

    if (sConf.url) {
      resolved.url = sConf.url.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar);
    }

    resolvedServers[sName] = resolved;
  }
  return resolvedServers;
}

export function extractSkillFiles(
  skill: SkillEntry,
  rawFiles?: Record<string, string>,
  localDir?: string
): Record<string, string> {
  const filesToInstall: Record<string, string> = {};

  // 1. Check skill.files from manifest
  if (skill.files && typeof skill.files === "object" && Object.keys(skill.files).length > 0) {
    for (const [fn, cnt] of Object.entries(skill.files)) {
      if (fn && !fn.includes("..") && !path.isAbsolute(fn)) {
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
        if (relName && !relName.includes("..") && !path.isAbsolute(relName)) {
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
    const candidateDirs = [
      path.join(localDir, "skills", skill.name),
      path.join(localDir, skill.name)
    ];
    for (const cDir of candidateDirs) {
      if (fs.existsSync(cDir) && fs.statSync(cDir).isDirectory()) {
        const allEntries = fs.readdirSync(cDir, { recursive: true });
        for (const entry of allEntries) {
          const full = path.join(cDir, entry as string);
          if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            const rel = path.relative(cDir, full).replaceAll("\\", "/");
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

export function installPackIntoAgents(
  manifest: Manifest,
  targetAgentIds: string[],
  resolvedServers: Record<string, McpServerConfig>,
  rawFiles?: Record<string, string>,
  localDir?: string,
  profiles?: Record<string, AgentProfile>
): { installedMcp: string[]; installedSkills: string[] } {
  const activeProfiles = profiles || getAgentProfiles();
  const installedMcp: string[] = [];
  const installedSkills: string[] = [];

  for (const agentId of targetAgentIds) {
    const profile = activeProfiles[agentId];
    if (!profile) continue;

    // Install MCP servers
    if (
      profile.mcpConfig &&
      profile.mcpConfig.paths &&
      profile.mcpConfig.paths.length > 0 &&
      Object.keys(resolvedServers).length > 0
    ) {
      const primaryPath = resolveActiveAgentPath(profile.mcpConfig.paths);
      if (primaryPath) {
        mergeMcpServersIntoFile(primaryPath, resolvedServers, profile.mcpConfig.key || "mcpServers");
        installedMcp.push(agentId);
      }
    }

    // Install Skills
    if (
      profile.skills &&
      profile.skills.paths &&
      profile.skills.paths.length > 0 &&
      manifest.skills &&
      manifest.skills.length > 0
    ) {
      const primarySkillsDir = resolveActiveAgentPath(profile.skills.paths);
      if (primarySkillsDir) {
        for (const skill of manifest.skills) {
          const filesToInstall = extractSkillFiles(skill, rawFiles, localDir);
          installSkillFiles(primarySkillsDir, skill.name, filesToInstall);
        }
        installedSkills.push(agentId);
      }
    }
  }

  return { installedMcp, installedSkills };
}

export async function installCommand(source: string, options?: InstallCommandOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" smcp — Install Agent Pack ")));

  const sFetch = p.spinner();
  sFetch.start(`Fetching pack from ${source}...`);

  let manifest: Manifest;
  let rawFiles: Record<string, string> = {};
  let localDir: string | undefined = undefined;

  try {
    const trimmedSource = source.trim();
    const isUrl = trimmedSource.startsWith("http://") || trimmedSource.startsWith("https://");
    const isGistHexId = !isUrl && !fs.existsSync(trimmedSource) && /^[a-fA-F0-9]{20,40}$/.test(trimmedSource);

    if (isUrl || isGistHexId) {
      const auth = getAuthConfig();
      const gist = await GitHubClient.fetchGist(trimmedSource, auth.githubToken);
      if (!gist.files || !gist.files["smcp.json"]) {
        throw new Error("Gist does not contain an smcp.json manifest file.");
      }
      manifest = ManifestSchema.parse(JSON.parse(gist.files["smcp.json"].content));
      for (const [filename, fileObj] of Object.entries(gist.files)) {
        rawFiles[filename] = fileObj.content;
      }
    } else if (fs.existsSync(trimmedSource)) {
      const stat = fs.statSync(trimmedSource);
      let manifestPath = trimmedSource;
      if (stat.isDirectory()) {
        localDir = path.resolve(trimmedSource);
        manifestPath = path.join(trimmedSource, "smcp.json");
      } else {
        localDir = path.dirname(path.resolve(trimmedSource));
      }
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`smcp.json manifest not found at ${manifestPath}`);
      }
      const content = fs.readFileSync(manifestPath, "utf8");
      manifest = ManifestSchema.parse(JSON.parse(content));
    } else {
      throw new Error(`Unsupported source: ${source}. Must be a GitHub Gist URL or local path.`);
    }
    sFetch.stop(pc.green(`✔ Loaded pack: ${pc.bold(manifest.name)} (v${manifest.version})`));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sFetch.stop(pc.red("✖ Could not load pack"));
    p.cancel(message);
    return;
  }

  // Display summary
  const mcpNames = Object.keys(manifest.mcpServers || {});
  const skillNames = (manifest.skills || []).map((s) => s.name);
  console.log(`\n${pc.bold("Description:")} ${manifest.description || "(none)"}`);
  console.log(`${pc.bold("MCP Servers:")} ${mcpNames.join(", ") || "(none)"}`);
  console.log(`${pc.bold("Skills:")} ${skillNames.join(", ") || "(none)"}`);

  // Select target agents
  const detected = detectAgents();
  const allProfiles = getAgentProfiles();

  if (Object.keys(allProfiles).length === 0) {
    p.cancel("No agent profiles configured.");
    return;
  }

  let targetAgentIds: string[] = [];
  if (options?.agents && options.agents.length > 0) {
    targetAgentIds = options.agents.filter((id) => allProfiles[id]);
    if (targetAgentIds.length === 0) {
      p.cancel("None of the specified target agents were recognized.");
      return;
    }
  } else {
    const picked = await p.multiselect({
      message: "Select AI agent(s) to install into:",
      options: Object.entries(allProfiles).map(([id, prof]) => {
        const isDet = detected.some((d) => d.id === id);
        return {
          value: id,
          label: prof.name,
          hint: isDet ? "detected" : "configured"
        };
      }),
      required: true
    });
    if (p.isCancel(picked)) {
      p.cancel("Installation cancelled.");
      return;
    }
    targetAgentIds = picked as string[];
  }

  if (targetAgentIds.length === 0) {
    p.cancel("No target agents selected.");
    return;
  }

  // Handle Required Environment Variables & Template Placeholders
  const envValues: Record<string, string> = { ...(options?.env || {}) };
  const requiredEnvList: RequiredEnv[] = [...(manifest.requiredEnv || [])];
  const knownKeys = new Set(requiredEnvList.map((r) => r.key));

  const scanForPlaceholders = (str: string, isSecret = false) => {
    const matches = str.matchAll(/\${([a-zA-Z0-9_]+)}/g);
    for (const m of matches) {
      const varName = m[1];
      if (!knownKeys.has(varName)) {
        knownKeys.add(varName);
        requiredEnvList.push({
          key: varName,
          description: `Environment variable (${varName})`,
          isSecret
        });
      }
    }
  };

  for (const sConf of Object.values(manifest.mcpServers || {})) {
    if (sConf.env) {
      for (const [k, v] of Object.entries(sConf.env)) {
        scanForPlaceholders(v, isSecretKey(k));
      }
    }
    if (sConf.args) {
      for (const arg of sConf.args) {
        scanForPlaceholders(arg, false);
      }
    }
    if (sConf.url) {
      scanForPlaceholders(sConf.url, false);
    }
  }

  const missingEnvList = requiredEnvList.filter((req) => envValues[req.key] === undefined);

  if (missingEnvList.length > 0) {
    p.note("This pack requires environment variables for credentials/URLs.", "Environment Setup");
    for (const req of missingEnvList) {
      if (process.env[req.key]) {
        envValues[req.key] = process.env[req.key]!;
        p.log.info(`Using existing environment variable for ${pc.cyan(req.key)}`);
        continue;
      }

      const promptFn = req.isSecret ? p.password : p.text;
      const answer = await promptFn({
        message: `${req.key} (${req.description || "required value"}):`,
        validate: (val) => (!val || !val.trim() ? `${req.key} is required` : undefined)
      });
      if (p.isCancel(answer) || typeof answer !== "string") {
        p.cancel("Installation cancelled.");
        return;
      }
      envValues[req.key] = answer.trim();
    }
  }

  // Resolve templated MCP servers (including env, args, and url)
  const resolvedServers = resolveMcpServerTemplates(manifest.mcpServers || {}, envValues);

  // Check conflicts across target agents if not forced
  if (!options?.force) {
    let hasConflicts = false;
    for (const agentId of targetAgentIds) {
      const profile = allProfiles[agentId];
      if (!profile) continue;

      if (profile.mcpConfig && profile.mcpConfig.paths && profile.mcpConfig.paths.length > 0) {
        const pPath = resolveActiveAgentPath(profile.mcpConfig.paths);
        if (pPath) {
          const currentServers = readInstalledMcpServers(pPath, profile.mcpConfig.key || "mcpServers");
          for (const sName of Object.keys(resolvedServers)) {
            if (currentServers[sName]) {
              hasConflicts = true;
              break;
            }
          }
        }
      }
      if (hasConflicts) break;

      if (profile.skills && profile.skills.paths && profile.skills.paths.length > 0 && manifest.skills) {
        const sPath = resolveActiveAgentPath(profile.skills.paths);
        if (sPath) {
          for (const sk of manifest.skills) {
            if (fs.existsSync(path.join(sPath, sk.name))) {
              hasConflicts = true;
              break;
            }
          }
        }
      }
      if (hasConflicts) break;
    }

    if (hasConflicts) {
      const confirmOverwrite = await p.confirm({
        message: "Some MCP servers or skills already exist in the target agent(s). Overwrite existing configurations?",
        initialValue: true
      });
      if (p.isCancel(confirmOverwrite)) {
        p.cancel("Installation cancelled.");
        return;
      }
      if (!confirmOverwrite) {
        p.cancel("Installation cancelled by user.");
        return;
      }
    }
  }

  // Perform Installation
  const sInst = p.spinner();
  sInst.start("Installing skills and configuring MCP servers...");

  try {
    installPackIntoAgents(
      manifest,
      targetAgentIds,
      resolvedServers,
      rawFiles,
      localDir,
      allProfiles
    );
    sInst.stop(pc.green("✔ Installation completed!"));
    p.outro(pc.green(`Pack '${manifest.name}' is now active in: ${targetAgentIds.join(", ")}`));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sInst.stop(pc.red("✖ Installation failed"));
    p.cancel(message);
  }
}
