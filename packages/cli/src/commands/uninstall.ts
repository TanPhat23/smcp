import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  expandHome,
  getAgentProfiles,
  getInstalledPack,
  getInstalledPacks,
  isGlobalConfigPath,
  isPrototypePollutionKey,
  isStrictlyInside,
  removeInstalledPack,
  uninstallPackFromAgents
} from "@tanphat/smcp-core";

export interface UninstallCommandOptions {
  yes?: boolean;
  json?: boolean;
}

export async function uninstallCommand(
  packName?: string,
  options?: UninstallCommandOptions
): Promise<void> {
  const isAgentMode = Boolean(options?.json);
  const installedPacks = getInstalledPacks();
  const packNames = Object.keys(installedPacks);

  let targetName = packName;
  if (!targetName) {
    if (isAgentMode || options?.yes) {
      console.log(
        JSON.stringify({
          success: false,
          error: "Specify a pack name to uninstall."
        })
      );
      return;
    }

    if (packNames.length === 0) {
      p.intro(pc.bgCyan(pc.black(" smcp — Uninstall Pack ")));
      p.log.warn("No installed packs found.");
      p.outro("");
      return;
    }

    const picked = await p.select({
      message: "Select an installed pack to uninstall:",
      options: packNames.map((name) => ({
        value: name,
        label: name,
        hint: `v${installedPacks[name].version}`
      }))
    });

    if (p.isCancel(picked)) {
      p.cancel("Uninstall cancelled.");
      return;
    }
    targetName = picked as string;
  }

  const record = getInstalledPack(targetName);
  if (!record) {
    const errorMsg = `Pack '${targetName}' is not installed. Use 'smcp list' to view installed packs.`;
    if (isAgentMode) {
      console.log(JSON.stringify({ success: false, error: errorMsg }));
    } else {
      p.log.error(pc.red(errorMsg));
    }
    return;
  }

  if (!isAgentMode && !options?.yes) {
    p.intro(pc.bgCyan(pc.black(` smcp — Uninstall '${targetName}' `)));
    const confirmed = await p.confirm({
      message: `Are you sure you want to remove '${targetName}' and its components from active agents?`
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Uninstall cancelled.");
      return;
    }
  }

  const result = uninstallPackFromAgents(record);
  removeInstalledPack(targetName);

  const removedAgents: string[] = [...(result.removedAgents || [])];

  if (record.installedAgents && record.installedAgents.length > 0) {
    const allProfiles = getAgentProfiles();
    const targetAgentIds =
      record.targetAgents && record.targetAgents.length > 0
        ? record.targetAgents
        : Object.keys(allProfiles);

    for (const agentId of targetAgentIds) {
      const profile = allProfiles[agentId];
      if (!profile?.agents?.paths) continue;
      for (const p of profile.agents.paths) {
        const candidateDir = isGlobalConfigPath(p) ? expandHome(p) : path.resolve(p);
        if (fs.existsSync(candidateDir)) {
          try {
            const canonicalBase = fs.realpathSync(candidateDir);
            for (const agentName of record.installedAgents) {
              if (!agentName || isPrototypePollutionKey(agentName)) continue;
              const fileCandidates = [`${agentName}.md`, agentName];
              for (const fName of fileCandidates) {
                const targetFile = path.resolve(candidateDir, fName);
                if (fs.existsSync(targetFile)) {
                  try {
                    const realTarget = fs.realpathSync(targetFile);
                    if (isStrictlyInside(canonicalBase, realTarget)) {
                      fs.rmSync(realTarget, { force: true });
                      if (!removedAgents.includes(agentName)) {
                        removedAgents.push(agentName);
                      }
                    }
                  } catch {
                    // Ignore removal error
                  }
                }
              }
            }
          } catch {
            // Ignore dir realpath error
          }
        }
      }
    }
  }

  if (isAgentMode) {
    console.log(
      JSON.stringify(
        {
          success: true,
          pack: targetName,
          removedMcp: result.removedMcp,
          removedSkills: result.removedSkills,
          removedPlugins: result.removedPlugins,
          removedAgents
        },
        null,
        2
      )
    );
    return;
  }

  p.log.success(pc.green(`✔ Pack '${targetName}' uninstalled successfully.`));
  if (result.removedMcp.length > 0) {
    p.log.info(`Removed MCP servers: ${result.removedMcp.join(", ")}`);
  }
  if (result.removedSkills.length > 0) {
    p.log.info(`Removed skills: ${result.removedSkills.join(", ")}`);
  }
  if (result.removedPlugins.length > 0) {
    p.log.info(`Removed plugins: ${result.removedPlugins.join(", ")}`);
  }
  if (removedAgents.length > 0) {
    p.log.info(`Removed agents: ${removedAgents.join(", ")}`);
  }
  p.outro("");
}
