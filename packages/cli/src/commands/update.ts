import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  checkPackUpdateStatus,
  getInstalledPack,
  getInstalledPacks,
  recordInstalledPack,
  type InstalledPackRecord
} from "@tanphat/smcp-core";
import { installCommand } from "./install/install.ts";

export interface UpdateCommandOptions {
  all?: boolean;
  force?: boolean;
  runtime?: string;
  yes?: boolean;
  json?: boolean;
}

export async function updateCommand(
  packName?: string,
  options?: UpdateCommandOptions
): Promise<void> {
  const isAgentMode = Boolean(options?.json);
  const installedPacks = getInstalledPacks();
  const packNames = Object.keys(installedPacks);

  if (packNames.length === 0) {
    if (isAgentMode) {
      console.log(
        JSON.stringify({
          success: false,
          error: "No installed packs found. Use 'smcp install <source>' first."
        })
      );
      return;
    }
    p.intro(pc.bgCyan(pc.black(" smcp — Update Agent Pack ")));
    p.log.warn("No installed packs found.");
    p.outro("");
    return;
  }

  // Target all packs
  if (options?.all) {
    if (!isAgentMode) {
      p.intro(pc.bgCyan(pc.black(" smcp — Update All Packs ")));
    }

    const updatedPacks: string[] = [];
    const skippedPacks: string[] = [];
    const failedPacks: Array<{ name: string; error: string }> = [];

    for (const name of packNames) {
      const record = installedPacks[name];
      const check = await checkPackUpdateStatus(record);

      if (check.status === "deleted") {
        failedPacks.push({
          name,
          error: `Upstream source was deleted or returned 404 (${record.source})`
        });
        continue;
      }

      if (check.status === "up-to-date" && !options?.force) {
        skippedPacks.push(name);
        continue;
      }

      try {
        await installCommand(record.source, {
          agents: record.targetAgents,
          runtime: options?.runtime || record.runtime,
          force: true,
          yes: true,
          json: isAgentMode
        });
        updatedPacks.push(name);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        failedPacks.push({ name, error: msg });
      }
    }

    if (isAgentMode) {
      console.log(
        JSON.stringify({
          success: failedPacks.length === 0,
          updatedPacks,
          skippedPacks,
          failedPacks
        })
      );
      return;
    }

    if (updatedPacks.length > 0) {
      p.log.success(pc.green(`✔ Updated: ${updatedPacks.join(", ")}`));
    }
    if (skippedPacks.length > 0) {
      p.log.info(pc.dim(`Already up to date: ${skippedPacks.join(", ")}`));
    }
    if (failedPacks.length > 0) {
      for (const f of failedPacks) {
        p.log.error(pc.red(`✖ Failed to update '${f.name}': ${f.error}`));
      }
    }
    p.outro(pc.green("Finished updating packs."));
    return;
  }

  // Target specific pack
  let targetName = packName;
  if (!targetName) {
    if (isAgentMode || options?.yes) {
      console.log(
        JSON.stringify({
          success: false,
          error: "Specify a pack name or use --all to update all packs."
        })
      );
      return;
    }

    const picked = await p.select({
      message: "Select an installed pack to update:",
      options: packNames.map((name) => ({
        value: name,
        label: name,
        hint: `v${installedPacks[name].version}`
      }))
    });

    if (p.isCancel(picked)) {
      p.cancel("Update cancelled.");
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

  if (!isAgentMode) {
    p.intro(pc.bgCyan(pc.black(` smcp — Update '${targetName}' `)));
  }

  const check = await checkPackUpdateStatus(record);

  if (check.status === "deleted") {
    const errorMsg = `Cannot update '${targetName}': upstream source at ${record.source} was deleted or returned 404. Your local configuration was not modified.`;
    if (isAgentMode) {
      console.log(JSON.stringify({ success: false, error: errorMsg }));
    } else {
      p.log.error(pc.red(`✖ ${errorMsg}`));
      p.log.info(
        pc.yellow(`To remove this pack from your agents, run: smcp uninstall ${targetName}`)
      );
      p.outro("");
    }
    return;
  }

  if (check.status === "up-to-date" && !options?.force) {
    const msg = `Pack '${targetName}' is already up to date (version ${record.version}).`;
    if (isAgentMode) {
      console.log(
        JSON.stringify({
          success: true,
          updated: false,
          message: msg,
          version: record.version
        })
      );
    } else {
      p.log.info(pc.green(`✔ ${msg}`));
      p.log.message(`Use ${pc.bold("--force")} to re-install anyway.`);
      p.outro("");
    }
    return;
  }

  // Run update via installCommand with force
  await installCommand(record.source, {
    agents: record.targetAgents,
    runtime: options?.runtime || record.runtime,
    force: true,
    yes: true,
    json: isAgentMode
  });
}
