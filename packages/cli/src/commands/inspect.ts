import * as p from "@clack/prompts";
import pc from "picocolors";
import { collectRequiredEnv, loadPackFromSource, type Manifest } from "@tanphat/smcp-core";

export interface InspectCommandOptions {
  json?: boolean;
}

export async function inspectCommand(
  source: string,
  options?: InspectCommandOptions
): Promise<Manifest | null> {
  if (options?.json) {
    if (!source || !source.trim()) {
      console.error(JSON.stringify({ error: "Source path or URL is required." }));
      return null;
    }
    try {
      const loaded = await loadPackFromSource(source);
      const manifest = loaded.manifest;
      const requiredEnv = collectRequiredEnv(manifest);
      console.log(
        JSON.stringify(
          {
            manifest,
            requiredEnv,
            installCommand: `smcp install ${source}`
          },
          null,
          2
        )
      );
      return manifest;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ error: message }));
      return null;
    }
  }

  p.intro(pc.bgCyan(pc.black(" smcp — Inspect Agent Pack ")));

  if (!source || !source.trim()) {
    p.cancel("Source path or URL is required.");
    return null;
  }

  const sFetch = p.spinner();
  sFetch.start(`Fetching pack from ${source}...`);

  let manifest: Manifest;

  try {
    const loaded = await loadPackFromSource(source);
    manifest = loaded.manifest;
    sFetch.stop(pc.green(`✔ Loaded pack: ${pc.bold(manifest.name)} (v${manifest.version})`));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sFetch.stop(pc.red("✖ Could not load pack"));
    p.cancel(message);
    return null;
  }

  // Pack Details
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

  // Collect Required Env Vars (from manifest.requiredEnv + scan placeholders in mcpServers)
  const requiredEnvList = collectRequiredEnv(manifest);

  // Display Required Env Vars
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

  // Display MCP Servers
  const servers = Object.entries(manifest.mcpServers || {});
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

  // Display Skills
  const skills = manifest.skills || [];
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

  // Display Plugins
  const plugins = manifest.plugins || [];
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

  p.note(
    `To install this pack, run:\n  smcp install ${source}`,
    "Ready to install?"
  );

  p.outro("");
  return manifest;
}
