import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  parseAgentMarkdown,
  type AgentEntry,
  type Manifest,
  type UniversalAgent
} from "@tanphat/smcp-core";
import { bundlePluginFiles, bundleSkillFiles } from "../share/bundle.ts";
import {
  discoverPackComponents,
  type DiscoveredAgent,
  type DiscoveredPackComponents
} from "./discovery.ts";

export interface BundledAgentsResult {
  bundledAgents: AgentEntry[];
  rawFiles: Record<string, string>;
  gistFiles: Record<string, { content: string }>;
}

/**
 * Bundles discovered agents into clean manifest AgentEntry objects, raw file maps,
 * and Gist-compatible file maps.
 *
 * @param agents Discovered agents or existing AgentEntry records.
 * @param baseDir Optional workspace directory to resolve file paths from.
 * @returns Bundled agents and raw file contents.
 */
export function bundleAgentFiles(
  agents: (DiscoveredAgent | AgentEntry)[],
  baseDir?: string
): BundledAgentsResult {
  const bundledAgents: AgentEntry[] = [];
  const rawFiles: Record<string, string> = {};
  const gistFiles: Record<string, { content: string }> = {};

  for (const agent of agents) {
    let content = (agent as DiscoveredAgent).rawContent;
    const relPath = agent.path || path.posix.join("agents", `${agent.name}.md`);

    if (!content) {
      const fullPath = baseDir ? path.resolve(baseDir, relPath) : path.resolve(relPath);
      if (fs.existsSync(fullPath)) {
        try {
          content = fs.readFileSync(fullPath, "utf8");
        } catch {
          // Will fall back to synthetic template if unreadable
        }
      }
    }

    if (!content) {
      content = `---\nname: ${agent.name}\ndescription: ${agent.description || agent.name}\nmode: ${agent.mode || "subagent"}\n---\n`;
    }

    let parsed: UniversalAgent;
    try {
      parsed = parseAgentMarkdown(content, relPath);
    } catch {
      parsed = {
        name: agent.name,
        description: agent.description || agent.name,
        mode: agent.mode || "subagent",
        skills: [],
        prompt: ""
      };
    }

    const agentEntry: AgentEntry = {
      name: parsed.name,
      description: parsed.description,
      mode: parsed.mode,
      path: relPath,
      ...(parsed.model ? { model: parsed.model } : {})
    };

    bundledAgents.push(agentEntry);
    rawFiles[relPath] = content;
    gistFiles[`agents_${parsed.name}.md`] = { content };
  }

  return { bundledAgents, rawFiles, gistFiles };
}

export interface PackOptions {
  name?: string;
  version?: string;
  description?: string;
  outputDir?: string;
  json?: boolean;
}

export interface PackedResult {
  manifest: Manifest;
  rawFiles: Record<string, string>;
  gistFiles: Record<string, { content: string }>;
  outputDir?: string;
}

/**
 * Packs a directory of skills, plugins, and universal agents into an smcp pack bundle.
 *
 * @param dir Source directory. Defaults to current working directory.
 * @param options Packaging configuration options.
 */
export async function packDirectory(
  dir: string = ".",
  options?: PackOptions
): Promise<PackedResult> {
  const rootDir = path.resolve(dir);
  const components: DiscoveredPackComponents = discoverPackComponents(rootDir);

  const manifest: Manifest = components.manifest || {
    name: options?.name || path.basename(rootDir),
    version: options?.version || "1.0.0",
    description: options?.description || "",
    mcpServers: {},
    skills: [],
    plugins: [],
    agents: [],
    requiredEnv: []
  };

  if (options?.name) manifest.name = options.name;
  if (options?.version) manifest.version = options.version;
  if (options?.description) manifest.description = options.description;

  const rawFiles: Record<string, string> = {};
  const gistFiles: Record<string, { content: string }> = {};

  // 1. Bundle Agents
  if (components.agents && components.agents.length > 0) {
    const { bundledAgents, rawFiles: agentRawFiles, gistFiles: agentGistFiles } = bundleAgentFiles(
      components.agents,
      rootDir
    );
    manifest.agents = bundledAgents;
    Object.assign(rawFiles, agentRawFiles);
    Object.assign(gistFiles, agentGistFiles);
  }

  // 2. Bundle Skills
  if (components.skills && components.skills.length > 0) {
    const { bundledSkills, gistFiles: skillGistFiles } = bundleSkillFiles(components.skills);
    manifest.skills = bundledSkills;
    Object.assign(gistFiles, skillGistFiles);
    for (const sk of bundledSkills) {
      if (sk.files) {
        for (const [fileRel, fileContent] of Object.entries(sk.files)) {
          rawFiles[`skills/${sk.name}/${fileRel}`] = fileContent;
        }
      }
    }
  }

  // 3. Bundle Plugins
  if (components.plugins && components.plugins.length > 0) {
    const { bundledPlugins, gistFiles: pluginGistFiles } = await bundlePluginFiles(components.plugins);
    manifest.plugins = bundledPlugins;
    Object.assign(gistFiles, pluginGistFiles);
    for (const pl of bundledPlugins) {
      if (typeof pl === "object" && pl.files) {
        for (const [fileRel, fileContent] of Object.entries(pl.files)) {
          rawFiles[`plugins/${pl.name}/${fileRel}`] = fileContent;
        }
      }
    }
  }

  // Manifest file
  const manifestContent = JSON.stringify(manifest, null, 2) + "\n";
  rawFiles["smcp.json"] = manifestContent;
  gistFiles["smcp.json"] = { content: manifestContent };

  // Write to outputDir if provided
  if (options?.outputDir) {
    const outDir = path.resolve(options.outputDir);
    fs.mkdirSync(outDir, { recursive: true });
    for (const [filePath, fileContent] of Object.entries(rawFiles)) {
      const targetPath = path.join(outDir, filePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, fileContent, "utf8");
    }
    return {
      manifest,
      rawFiles,
      gistFiles,
      outputDir: outDir
    };
  }

  return {
    manifest,
    rawFiles,
    gistFiles
  };
}

/**
 * CLI command handler for `smcp pack [dir]`.
 */
export async function packCommand(dir: string = ".", options?: PackOptions): Promise<PackedResult | null> {
  const isJson = Boolean(options?.json);

  try {
    const result = await packDirectory(dir, options);
    if (isJson) {
      console.log(
        JSON.stringify(
          {
            success: true,
            manifest: result.manifest,
            files: Object.keys(result.rawFiles),
            outputDir: result.outputDir
          },
          null,
          2
        )
      );
    } else {
      p.intro(pc.bgCyan(pc.black(" smcp — Pack Bundle ")));
      p.note(
        `Packed ${result.manifest.name} (v${result.manifest.version}):\n` +
          `  Agents:  ${result.manifest.agents?.length || 0}\n` +
          `  Skills:  ${result.manifest.skills?.length || 0}\n` +
          `  Plugins: ${result.manifest.plugins?.length || 0}\n` +
          `  Total files: ${Object.keys(result.rawFiles).length}`,
        "Pack Created"
      );
      if (result.outputDir) {
        p.outro(pc.green(`✔ Saved to ${result.outputDir}`));
      } else {
        p.outro(pc.green("✔ Pack bundled successfully"));
      }
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJson) {
      console.error(JSON.stringify({ success: false, error: message }));
    } else {
      p.cancel(message);
    }
    return null;
  }
}
