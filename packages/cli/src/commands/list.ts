import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  detectAgents,
  filterAgents,
  getAgentProfiles,
  readInstalledHooks,
  readInstalledMcpServers,
  readInstalledPlugins,
  scanAgents,
  scanRules,
  scanSkills
} from "@tanphat/smcp-core";

export interface ListCommandOptions {
  agents?: string[];
  settings?: boolean;
  verbose?: boolean;
  json?: boolean;
}

export function listCommand(options?: ListCommandOptions): void {
  let agents = detectAgents();
  if (options?.agents && options.agents.length > 0) {
    agents = filterAgents(agents, options.agents);
  }

  const profiles = getAgentProfiles();

  if (options?.json) {
    const jsonOutput = {
      agents: agents.map((agent) => {
        const profile = profiles[agent.id];
        const servers = agent.mcpConfigPath
          ? readInstalledMcpServers(
              agent.mcpConfigPath,
              profile?.mcpConfig?.key || "mcpServers"
            )
          : {};
        const skills = agent.skillsDirPath ? scanSkills(agent.skillsDirPath) : [];
        const plugins =
          agent.pluginsConfigPath || agent.pluginsDirPath
            ? readInstalledPlugins(
                agent.pluginsConfigPath || "",
                profile?.plugins?.key,
                profile?.plugins?.format,
                profile?.plugins?.dirPaths || (agent.pluginsDirPath ? [agent.pluginsDirPath] : undefined),
                agent.id
              )
            : [];
        const agentsList = agent.agentsDirPath ? scanAgents(agent.agentsDirPath) : [];
        const rulesList = agent.rulesPaths?.length ? scanRules(agent.rulesPaths) : [];
        const hooksMap = agent.hooksConfigPath
          ? readInstalledHooks(agent.hooksConfigPath, profile?.hooks?.key)
          : {};
        return {
          id: agent.id,
          name: agent.name,
          mcpConfigPath: agent.mcpConfigPath,
          skillsDirPath: agent.skillsDirPath,
          pluginsConfigPath: agent.pluginsConfigPath,
          pluginsDirPath: agent.pluginsDirPath,
          agentsDirPath: agent.agentsDirPath,
          ...(agent.rulesPaths ? { rulesPaths: agent.rulesPaths } : {}),
          ...(agent.hooksConfigPath ? { hooksConfigPath: agent.hooksConfigPath } : {}),
          mcpServers: servers,
          skills: skills.map((sk) => ({
            name: sk.name,
            path: sk.path,
            description: sk.description,
            contentHash: sk.contentHash
          })),
          plugins,
          agents: agentsList.map((ag) => ({
            name: ag.name,
            path: ag.path,
            description: ag.description,
            mode: ag.mode,
            model: ag.model
          })),
          ...(rulesList.length > 0
            ? {
                rules: rulesList.map((r) => ({
                  name: r.name,
                  path: r.path,
                  contentHash: r.contentHash
                }))
              }
            : {}),
          ...(Object.keys(hooksMap).length > 0 ? { hooks: hooksMap } : {})
        };
      })
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  p.intro(pc.bgCyan(pc.black(" smcp — Installed Skills & MCPs ")));

  if (agents.length === 0) {
    if (options?.agents && options.agents.length > 0) {
      p.log.warn(`No matching agents detected for: ${options.agents.join(", ")}`);
    } else {
      p.log.warn("No supported AI agents detected on this machine.");
    }
    p.outro("");
    return;
  }

  const showSettings = Boolean(options?.settings || options?.verbose);

  for (const agent of agents) {
    console.log(`\n${pc.bold(pc.magenta("● " + agent.name))} ${pc.dim(`(${agent.id})`)}`);

    if (showSettings) {
      if (agent.mcpConfigPath) {
        console.log(`  ${pc.dim("MCP Config:")} ${pc.cyan(agent.mcpConfigPath)}`);
      }
      if (agent.skillsDirPath) {
        console.log(`  ${pc.dim("Skills Dir:")} ${pc.green(agent.skillsDirPath)}`);
      }
      if (agent.pluginsConfigPath) {
        console.log(`  ${pc.dim("Plugins Config:")} ${pc.yellow(agent.pluginsConfigPath)}`);
      }
      if (agent.pluginsDirPath) {
        console.log(`  ${pc.dim("Plugins Dir:")} ${pc.yellow(agent.pluginsDirPath)}`);
      }
      if (agent.agentsDirPath) {
        console.log(`  ${pc.dim("Agents Dir:")} ${pc.blue(agent.agentsDirPath)}`);
      }
    }

    if (agent.mcpConfigPath) {
      const profile = profiles[agent.id];
      const servers = readInstalledMcpServers(
        agent.mcpConfigPath,
        profile?.mcpConfig?.key || "mcpServers"
      );
      const serverNames = Object.keys(servers);
      console.log(`  ${pc.cyan("MCP Servers")} (${pc.dim(agent.mcpConfigPath)}):`);
      if (serverNames.length === 0) {
        console.log(`    ${pc.dim("(none)")}`);
      } else {
        for (const s of serverNames) {
          const cfg = servers[s];
          if (showSettings) {
            console.log(`    - ${pc.bold(pc.cyan(s))}:`);
            if (cfg.command) {
              const fullCmd = [cfg.command, ...(cfg.args || [])].join(" ");
              console.log(`        ${pc.dim("Command:")} ${fullCmd}`);
            }
            if (cfg.args && cfg.args.length > 0) {
              console.log(`        ${pc.dim("Args:")} ${JSON.stringify(cfg.args)}`);
            }
            if (cfg.url) {
              console.log(`        ${pc.dim("URL:")} ${cfg.url}`);
            }
            if (cfg.type) {
              console.log(`        ${pc.dim("Type:")} ${cfg.type}`);
            }
            if (cfg.env && Object.keys(cfg.env).length > 0) {
              const envList = Object.entries(cfg.env)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ");
              console.log(`        ${pc.dim("Env:")} ${envList}`);
            }
          } else {
            let info = cfg.command || cfg.url || "configured";
            if (cfg.command && cfg.args && cfg.args.length > 0) {
              info = `${cfg.command} ${cfg.args.join(" ")}`;
            }
            console.log(`    - ${pc.bold(s)}: ${info}`);
          }
        }
      }
    }

    if (agent.skillsDirPath) {
      const skills = scanSkills(agent.skillsDirPath);
      console.log(`  ${pc.green("Skills")} (${pc.dim(agent.skillsDirPath)}):`);
      if (skills.length === 0) {
        console.log(`    ${pc.dim("(none)")}`);
      } else {
        for (const sk of skills) {
          if (showSettings) {
            const desc = sk.description ? ` - ${sk.description}` : "";
            console.log(`    - ${pc.bold(sk.name)}${pc.dim(desc)}`);
            console.log(`        ${pc.dim("Path:")} ${sk.path}`);
          } else {
            console.log(`    - ${pc.bold(sk.name)}`);
          }
        }
      }
    }

    if (agent.pluginsConfigPath || agent.pluginsDirPath) {
      const profile = profiles[agent.id];
      const plugins = readInstalledPlugins(
        agent.pluginsConfigPath || "",
        profile?.plugins?.key,
        profile?.plugins?.format,
        profile?.plugins?.dirPaths || (agent.pluginsDirPath ? [agent.pluginsDirPath] : undefined),
        agent.id
      );
      const pluginSourceLabel = agent.pluginsConfigPath || agent.pluginsDirPath || "";
      console.log(`  ${pc.yellow("Plugins")} (${pc.dim(pluginSourceLabel)}):`);
      if (plugins.length === 0) {
        console.log(`    ${pc.dim("(none)")}`);
      } else {
        for (const pl of plugins) {
          const pName = typeof pl === "string" ? pl : pl.name;
          const pPath = typeof pl === "object" ? pl.path : undefined;
          if (showSettings) {
            console.log(`    - ${pc.bold(pc.yellow(pName))}`);
            if (pPath) {
              console.log(`        ${pc.dim("Path:")} ${pPath}`);
            }
          } else {
            console.log(`    - ${pc.bold(pName)}`);
          }
        }
      }
    }

    if (agent.agentsDirPath) {
      const agentsList = scanAgents(agent.agentsDirPath);
      console.log(`  ${pc.blue("Agents")} (${pc.dim(agent.agentsDirPath)}):`);
      if (agentsList.length === 0) {
        console.log(`    ${pc.dim("(none)")}`);
      } else {
        for (const ag of agentsList) {
          const modeHint = ag.mode ? ` (${ag.mode})` : "";
          if (showSettings) {
            const desc = ag.description ? ` - ${ag.description}` : "";
            console.log(`    - ${pc.bold(pc.blue(ag.name))}${pc.dim(modeHint)}${pc.dim(desc)}`);
            console.log(`        ${pc.dim("Path:")} ${ag.path}`);
          } else {
            console.log(`    - ${pc.bold(ag.name)}${pc.dim(modeHint)}`);
          }
        }
      }
    }

    if (agent.rulesPaths && agent.rulesPaths.length > 0) {
      const rulesList = scanRules(agent.rulesPaths);
      if (rulesList.length > 0) {
        console.log(`  ${pc.magenta("Rules")}:`);
        for (const r of rulesList) {
          if (showSettings) {
            console.log(`    - ${pc.bold(r.name)}`);
            console.log(`        ${pc.dim("Path:")} ${r.path}`);
          } else {
            console.log(`    - ${pc.bold(r.name)}`);
          }
        }
      }
    }

    if (agent.hooksConfigPath) {
      const profile = profiles[agent.id];
      const hooksMap = readInstalledHooks(agent.hooksConfigPath, profile?.hooks?.key);
      const hookNames = Object.keys(hooksMap);
      if (hookNames.length > 0) {
        console.log(`  ${pc.cyan("Hooks")} (${pc.dim(agent.hooksConfigPath)}):`);
        for (const hName of hookNames) {
          console.log(`    - ${pc.bold(hName)}`);
        }
      }
    }
  }

  p.outro("");
}
