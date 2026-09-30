import * as p from "@clack/prompts";
import pc from "picocolors";
import { getAgentProfiles } from "@tanphat/smcp-core";

export interface AgentListCommandOptions {
  json?: boolean;
}

export function agentListCommand(options?: AgentListCommandOptions): void {
  const profiles = getAgentProfiles();
  if (options?.json) {
    console.log(JSON.stringify(profiles, null, 2));
    return;
  }

  p.intro(pc.bgCyan(pc.black(" smcp — Supported Agents ")));

  for (const [id, profile] of Object.entries(profiles)) {
    console.log(`\n${pc.bold(pc.cyan(profile.name))} (${pc.dim(id)})`);
    if (profile.mcpConfig) {
      console.log(`  MCP Config paths: ${profile.mcpConfig.paths.join(", ")}`);
    } else {
      console.log(`  MCP Config: ${pc.dim("Not supported")}`);
    }
    if (profile.skills) {
      console.log(`  Skills paths: ${profile.skills.paths.join(", ")}`);
    } else {
      console.log(`  Skills: ${pc.dim("Not supported")}`);
    }
    if (profile.plugins) {
      console.log(`  Plugins Config paths: ${profile.plugins.paths.join(", ")}`);
      if (profile.plugins.dirPaths && profile.plugins.dirPaths.length > 0) {
        console.log(`  Plugins Dir paths: ${profile.plugins.dirPaths.join(", ")}`);
      }
    } else {
      console.log(`  Plugins: ${pc.dim("Not supported")}`);
    }
  }
  p.outro("");
}
