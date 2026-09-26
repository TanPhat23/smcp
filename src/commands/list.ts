import * as p from "@clack/prompts";
import pc from "picocolors";
import { detectAgents, getAgentProfiles, readInstalledMcpServers, scanSkills } from "../core/agents.ts";

export function listCommand(): void {
  p.intro(pc.bgCyan(pc.black(" smcp — Installed Skills & MCPs ")));

  const agents = detectAgents();
  if (agents.length === 0) {
    p.log.warn("No supported AI agents detected on this machine.");
    p.outro("");
    return;
  }

  const profiles = getAgentProfiles();

  for (const agent of agents) {
    console.log(`\n${pc.bold(pc.magenta("● " + agent.name))}`);

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
          const info = cfg.command || cfg.url || "configured";
          console.log(`    - ${pc.bold(s)}: ${info}`);
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
          console.log(`    - ${pc.bold(sk.name)}`);
        }
      }
    }
  }

  p.outro("");
}
