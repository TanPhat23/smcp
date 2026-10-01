import * as p from "@clack/prompts";
import pc from "picocolors";
import { checkPackUpdateStatus, getInstalledPacks, type PackUpdateCheckResult } from "@tanphat/smcp-core";

export interface OutdatedCommandOptions {
  json?: boolean;
}

export async function outdatedCommand(options?: OutdatedCommandOptions): Promise<void> {
  const isAgentMode = Boolean(options?.json);
  const installedPacks = getInstalledPacks();
  const packNames = Object.keys(installedPacks);

  if (packNames.length === 0) {
    if (isAgentMode) {
      console.log(JSON.stringify({ success: true, packs: [] }, null, 2));
      return;
    }
    p.intro(pc.bgCyan(pc.black(" smcp — Check for Updates ")));
    p.log.info("No installed packs found. Use 'smcp install <source>' to install a pack.");
    p.outro("");
    return;
  }

  let sCheck: any;
  if (!isAgentMode) {
    p.intro(pc.bgCyan(pc.black(" smcp — Check for Updates ")));
    sCheck = p.spinner();
    sCheck.start(`Checking updates for ${packNames.length} installed pack(s)...`);
  }

  const results: PackUpdateCheckResult[] = [];
  for (const name of packNames) {
    const record = installedPacks[name];
    const res = await checkPackUpdateStatus(record);
    results.push(res);
  }

  if (sCheck) {
    sCheck.stop(pc.green("✔ Update check completed"));
  }

  if (isAgentMode) {
    console.log(JSON.stringify({ success: true, packs: results }, null, 2));
    return;
  }

  console.log("");
  console.log(
    pc.bold(
      `${"PACK".padEnd(25)} ${"INSTALLED".padEnd(12)} ${"LATEST".padEnd(12)} ${"STATUS"}`
    )
  );
  console.log(pc.dim("─".repeat(70)));

  for (const r of results) {
    let statusText = pc.green("Up to date");
    if (r.status === "outdated") {
      statusText = pc.yellow(`Update available (${r.installedVersion} -> ${r.latestVersion})`);
    } else if (r.status === "deleted") {
      statusText = pc.red("⚠️ Upstream deleted / 404");
    } else if (r.status === "error") {
      statusText = pc.red(`Error: ${r.error || "failed to check"}`);
    }

    const nameCol = pc.cyan(r.name.padEnd(25));
    const instCol = r.installedVersion.padEnd(12);
    const latCol = (r.latestVersion || "-").padEnd(12);

    console.log(`${nameCol} ${instCol} ${latCol} ${statusText}`);
  }

  console.log("");
  const outdatedCount = results.filter((r) => r.status === "outdated").length;
  if (outdatedCount > 0) {
    p.log.message(
      `Run ${pc.bold("smcp update <pack>")} or ${pc.bold("smcp update --all")} to apply updates.`
    );
  } else {
    p.log.success("All installed packs are up to date.");
  }

  p.outro("");
}
