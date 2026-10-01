import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  getInstalledPack,
  getInstalledPacks,
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

  if (isAgentMode) {
    console.log(
      JSON.stringify(
        {
          success: true,
          pack: targetName,
          removedMcp: result.removedMcp,
          removedSkills: result.removedSkills,
          removedPlugins: result.removedPlugins,
          removedAgents: result.removedAgents || []
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
  if (result.removedAgents && result.removedAgents.length > 0) {
    p.log.info(`Removed agents: ${result.removedAgents.join(", ")}`);
  }
  p.outro("");
}
