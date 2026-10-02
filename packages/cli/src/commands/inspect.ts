import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  collectRequiredEnv,
  loadPackFromSource,
  type AgentEntry,
  type Manifest,
  type McpServerConfig,
  type PluginEntry,
  type SkillEntry
} from "@tanphat/smcp-core";
import { extractAgentContent, extractSkillFiles } from "./install/extract.ts";

export interface InspectCommandOptions {
  json?: boolean;
  skill?: string;
  agent?: string;
  server?: string;
  skills?: boolean;
  servers?: boolean;
  agents?: boolean;
  plugins?: boolean;
  noCache?: boolean;
  cache?: boolean;
}

export function formatInspectAgents(agents: AgentEntry[] = []): string {
  const count = agents.length;
  const header = `🤖 Agents (${count}):`;
  if (count === 0) {
    return `${header}\n  (none)`;
  }
  const lines = [header];
  for (const ag of agents) {
    const mode = ag.mode || "subagent";
    const desc = ag.description ? ` — ${ag.description}` : "";
    lines.push(`  • ${ag.name} (${mode})${desc}`);
  }
  return lines.join("\n");
}

export function printInspectServers(servers: [string, McpServerConfig][]): void {
  console.log(`\n${pc.bold(pc.magenta("MCP Servers:"))}`);
  if (servers.length === 0) {
    console.log(`  ${pc.dim("(none)")}`);
  } else {
    for (const [serverName, sConf] of servers) {
      console.log(`  - ${pc.bold(serverName)}:`);
      if (sConf.command) {
        const argsStr = sConf.args && sConf.args.length > 0 ? " " + sConf.args.join(" ") : "";
        console.log(`      ${pc.dim("Command:")} ${sConf.command}${argsStr}`);
      }
      if (sConf.url) {
        console.log(`      ${pc.dim("URL:")} ${sConf.url}`);
      }
      if (sConf.env && Object.keys(sConf.env).length > 0) {
        console.log(`      ${pc.dim("Env:")} ${Object.keys(sConf.env).join(", ")}`);
      }
    }
  }
}

export function printInspectSkills(skills: SkillEntry[]): void {
  console.log(`\n${pc.bold(pc.green("Skills:"))}`);
  if (skills.length === 0) {
    console.log(`  ${pc.dim("(none)")}`);
  } else {
    for (const sk of skills) {
      const desc = sk.description ? `: ${sk.description}` : "";
      console.log(`  - ${pc.bold(sk.name)}${desc}`);
      if (sk.files && Object.keys(sk.files).length > 0) {
        console.log(`      ${pc.dim("Files:")} ${Object.keys(sk.files).join(", ")}`);
      }
    }
  }
}

export function printInspectPlugins(plugins: PluginEntry[]): void {
  console.log(`\n${pc.bold(pc.yellow("Plugins:"))}`);
  if (plugins.length === 0) {
    console.log(`  ${pc.dim("(none)")}`);
  } else {
    for (const pl of plugins) {
      const pName = typeof pl === "string" ? pl : pl.name;
      const target = typeof pl === "object" && pl.targetAgent ? ` [${pl.targetAgent}]` : "";
      const desc = typeof pl === "object" && pl.description ? `: ${pl.description}` : "";
      console.log(`  - ${pc.bold(pName)}${pc.dim(target)}${desc}`);
      if (typeof pl === "object" && pl.files && Object.keys(pl.files).length > 0) {
        console.log(`      ${pc.dim("Files:")} ${Object.keys(pl.files).join(", ")}`);
      }
    }
  }
}

export async function inspectCommand(
  source: string,
  options?: InspectCommandOptions
): Promise<Manifest | null> {
  if (!source || !source.trim()) {
    if (options?.json) {
      console.error(JSON.stringify({ error: "Source path or URL is required." }));
    } else {
      p.cancel("Source path or URL is required.");
    }
    return null;
  }

  let loaded;
  try {
    const noCache = options?.noCache ?? (options?.cache === false ? true : undefined);
    loaded = await loadPackFromSource(source, { noCache });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (options?.json) {
      console.error(JSON.stringify({ error: message }));
    } else {
      p.cancel(message);
    }
    return null;
  }

  const manifest = loaded.manifest;

  // 1. Deep item inspection: --skill <name>
  if (options?.skill) {
    const targetSkillName = options.skill.trim().toLowerCase();
    const skills = manifest.skills || [];
    const foundSkill = skills.find((sk) => sk.name.toLowerCase() === targetSkillName);

    if (!foundSkill) {
      const errMsg = `Skill "${options.skill}" not found in pack "${manifest.name}".`;
      if (options.json) {
        console.error(JSON.stringify({ error: errMsg }));
      } else {
        p.cancel(errMsg);
      }
      return null;
    }

    const files = extractSkillFiles(foundSkill, loaded.rawFiles, loaded.localDir);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            pack: manifest.name,
            version: manifest.version,
            skill: {
              name: foundSkill.name,
              description: foundSkill.description,
              path: foundSkill.path,
              contentHash: foundSkill.contentHash,
              files
            }
          },
          null,
          2
        )
      );
      return manifest;
    }

    p.intro(pc.bgCyan(pc.black(` smcp — Skill Inspection: ${foundSkill.name} `)));
    console.log(`\n${pc.bold("Pack:")}        ${manifest.name} (v${manifest.version})`);
    console.log(`${pc.bold("Skill:")}       ${pc.bold(pc.green(foundSkill.name))}`);
    console.log(`${pc.bold("Description:")} ${foundSkill.description || pc.dim("(none)")}`);
    if (foundSkill.path) {
      console.log(`${pc.bold("Path:")}        ${foundSkill.path}`);
    }
    const fileEntries = Object.entries(files);
    console.log(`\n${pc.bold(pc.cyan(`Files (${fileEntries.length}):`))}`);
    for (const [filename, content] of fileEntries) {
      console.log(`\n${pc.bold(pc.yellow(`─── ${filename} ───`))}`);
      console.log(content.trim());
    }
    p.outro("");
    return manifest;
  }

  // 2. Deep item inspection: --agent <name>
  if (options?.agent) {
    const targetAgentName = options.agent.trim().toLowerCase();
    const agents = manifest.agents || [];
    const foundAgent = agents.find((ag) => ag.name.toLowerCase() === targetAgentName);

    if (!foundAgent) {
      const errMsg = `Agent "${options.agent}" not found in pack "${manifest.name}".`;
      if (options.json) {
        console.error(JSON.stringify({ error: errMsg }));
      } else {
        p.cancel(errMsg);
      }
      return null;
    }

    const content = extractAgentContent(foundAgent, loaded.rawFiles, loaded.localDir);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            pack: manifest.name,
            version: manifest.version,
            agent: foundAgent,
            content
          },
          null,
          2
        )
      );
      return manifest;
    }

    p.intro(pc.bgCyan(pc.black(` smcp — Agent Inspection: ${foundAgent.name} `)));
    console.log(`\n${pc.bold("Pack:")}        ${manifest.name} (v${manifest.version})`);
    console.log(`${pc.bold("Agent:")}       ${pc.bold(pc.blue(foundAgent.name))} (${foundAgent.mode || "subagent"})`);
    console.log(`${pc.bold("Description:")} ${foundAgent.description || pc.dim("(none)")}`);
    if (foundAgent.model) {
      console.log(`${pc.bold("Model:")}       ${foundAgent.model}`);
    }
    if (foundAgent.path) {
      console.log(`${pc.bold("Path:")}        ${foundAgent.path}`);
    }
    if (content) {
      console.log(`\n${pc.bold(pc.yellow("─── Agent Instructions / Prompt ───"))}`);
      console.log(content.trim());
    }
    p.outro("");
    return manifest;
  }

  // 3. Deep item inspection: --server <name>
  if (options?.server) {
    const targetServerName = options.server.trim().toLowerCase();
    const servers = manifest.mcpServers || {};
    const foundEntry = Object.entries(servers).find(([k]) => k.toLowerCase() === targetServerName);

    if (!foundEntry) {
      const errMsg = `MCP Server "${options.server}" not found in pack "${manifest.name}".`;
      if (options.json) {
        console.error(JSON.stringify({ error: errMsg }));
      } else {
        p.cancel(errMsg);
      }
      return null;
    }

    const [serverName, serverConfig] = foundEntry;
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            pack: manifest.name,
            version: manifest.version,
            server: {
              name: serverName,
              config: serverConfig
            }
          },
          null,
          2
        )
      );
      return manifest;
    }

    p.intro(pc.bgCyan(pc.black(` smcp — MCP Server Inspection: ${serverName} `)));
    console.log(`\n${pc.bold("Pack:")}        ${manifest.name} (v${manifest.version})`);
    console.log(`${pc.bold("Server:")}      ${pc.bold(pc.magenta(serverName))}`);
    if (serverConfig.command) {
      const argsStr = serverConfig.args && serverConfig.args.length > 0 ? " " + serverConfig.args.join(" ") : "";
      console.log(`${pc.bold("Command:")}     ${serverConfig.command}${argsStr}`);
    }
    if (serverConfig.url) {
      console.log(`${pc.bold("URL:")}         ${serverConfig.url}`);
    }
    if (serverConfig.env && Object.keys(serverConfig.env).length > 0) {
      console.log(`${pc.bold("Environment:")} ${Object.keys(serverConfig.env).join(", ")}`);
    }
    p.outro("");
    return manifest;
  }

  // 4. Category filtering: --skills, --servers, --agents, --plugins
  const hasCategoryFilter = Boolean(options?.skills || options?.servers || options?.agents || options?.plugins);
  if (hasCategoryFilter) {
    if (options?.json) {
      const filtered: Record<string, unknown> = {
        pack: manifest.name,
        version: manifest.version
      };
      if (options.servers) filtered.mcpServers = manifest.mcpServers || {};
      if (options.skills) filtered.skills = manifest.skills || [];
      if (options.plugins) filtered.plugins = manifest.plugins || [];
      if (options.agents) filtered.agents = manifest.agents || [];
      console.log(JSON.stringify(filtered, null, 2));
      return manifest;
    }

    p.intro(pc.bgCyan(pc.black(" smcp — Inspect Agent Pack ")));
    console.log(`\n${pc.bold(pc.cyan("Pack Details:"))}`);
    console.log(`  ${pc.bold("Name:")}        ${manifest.name}`);
    console.log(`  ${pc.bold("Version:")}     ${manifest.version}`);

    if (options?.servers) {
      printInspectServers(Object.entries(manifest.mcpServers || {}));
    }
    if (options?.skills) {
      printInspectSkills(manifest.skills || []);
    }
    if (options?.plugins) {
      printInspectPlugins(manifest.plugins || []);
    }
    if (options?.agents) {
      console.log(`\n` + formatInspectAgents(manifest.agents || []));
    }

    p.note(`To install this pack, run:\n  smcp install ${source}`, "Ready to install?");
    p.outro("");
    return manifest;
  }

  // 5. Default full inspection
  if (options?.json) {
    const requiredEnv = collectRequiredEnv(manifest);
    console.log(
      JSON.stringify(
        {
          manifest,
          agents: manifest.agents || [],
          requiredEnv,
          installCommand: `smcp install ${source}`
        },
        null,
        2
      )
    );
    return manifest;
  }

  p.intro(pc.bgCyan(pc.black(" smcp — Inspect Agent Pack ")));
  console.log(`\n${pc.bold(pc.cyan("Pack Details:"))}`);
  console.log(`  ${pc.bold("Name:")}        ${manifest.name}`);
  console.log(`  ${pc.bold("Version:")}     ${manifest.version}`);
  console.log(`  ${pc.bold("Description:")} ${manifest.description || pc.dim("(none)")}`);
  if (manifest.createdAt) {
    console.log(`  ${pc.bold("Created:")}     ${manifest.createdAt}`);
  }
  if (manifest.updatedAt) {
    console.log(`  ${pc.bold("Updated:")}     ${manifest.updatedAt}`);
  }

  // Required Env Vars
  const requiredEnvList = collectRequiredEnv(manifest);
  console.log(`\n${pc.bold(pc.yellow("Required Environment Variables:"))}`);
  if (requiredEnvList.length === 0) {
    console.log(`  ${pc.dim("(none)")}`);
  } else {
    for (const env of requiredEnvList) {
      const secretTag = env.isSecret ? pc.red(" [secret]") : "";
      const isSet = process.env[env.key] !== undefined;
      const statusTag = isSet
        ? pc.green(" (set in current environment)")
        : pc.dim(" (not set)");
      console.log(`  - ${pc.bold(env.key)}${secretTag}: ${env.description || "required value"}${statusTag}`);
    }
  }

  // MCP Servers
  printInspectServers(Object.entries(manifest.mcpServers || {}));

  // Skills
  printInspectSkills(manifest.skills || []);

  // Plugins
  printInspectPlugins(manifest.plugins || []);

  // Agents
  console.log(`\n` + formatInspectAgents(manifest.agents || []));

  p.note(`To install this pack, run:\n  smcp install ${source}`, "Ready to install?");
  p.outro("");
  return manifest;
}
