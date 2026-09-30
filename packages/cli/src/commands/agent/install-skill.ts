import * as p from "@clack/prompts";
import pc from "picocolors";
import { detectAgents, installSkillFiles } from "@tanphat/smcp-core";
import { SMCP_AGENT_SKILL_CONTENT } from "../instructions.ts";

export interface AgentInstallSkillCommandOptions {
  json?: boolean;
}

export function agentInstallSkillCommand(options?: AgentInstallSkillCommandOptions): void {
  const detected = detectAgents();
  const installedTo: string[] = [];

  for (const agent of detected) {
    if (agent.skillsDirPath) {
      try {
        installSkillFiles(agent.skillsDirPath, "smcp", {
          "SKILL.md": SMCP_AGENT_SKILL_CONTENT
        });
        installedTo.push(agent.name);
      } catch {
        // Skip failed skill install
      }
    }
  }

  if (options?.json) {
    console.log(
      JSON.stringify(
        {
          success: installedTo.length > 0,
          installedTo
        },
        null,
        2
      )
    );
    return;
  }

  p.intro(pc.bgCyan(pc.black(" smcp — Install Agent Skill ")));
  if (installedTo.length === 0) {
    p.log.warn("No active agent skills directories detected.");
  } else {
    p.log.success(
      pc.green(`✔ Installed 'smcp' skill into: ${installedTo.join(", ")}`)
    );
  }
  p.outro("");
}
