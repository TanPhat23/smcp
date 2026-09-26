import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { GitHubClient } from "../core/github.ts";
import { isSecretKey } from "../core/redactor.ts";
import { getAuthConfig } from "../core/state.ts";
import { ManifestSchema, type Manifest, type RequiredEnv } from "../types.ts";

export async function inspectCommand(source: string): Promise<Manifest | null> {
  p.intro(pc.bgCyan(pc.black(" smcp — Inspect Agent Pack ")));

  if (!source || !source.trim()) {
    p.cancel("Source path or URL is required.");
    return null;
  }

  const sFetch = p.spinner();
  sFetch.start(`Fetching pack from ${source}...`);

  let manifest: Manifest;
  let rawFiles: Record<string, string> = {};

  try {
    const trimmedSource = source.trim();
    const isUrl = trimmedSource.startsWith("http://") || trimmedSource.startsWith("https://");
    const isGistHexId = !isUrl && !fs.existsSync(trimmedSource) && /^[a-fA-F0-9]{20,40}$/.test(trimmedSource);

    if (isUrl || isGistHexId) {
      const auth = getAuthConfig();
      const gist = await GitHubClient.fetchGist(trimmedSource, auth.githubToken);
      if (!gist.files || !gist.files["smcp.json"]) {
        throw new Error("Gist does not contain an smcp.json manifest file.");
      }
      manifest = ManifestSchema.parse(JSON.parse(gist.files["smcp.json"].content));
      for (const [filename, fileObj] of Object.entries(gist.files)) {
        rawFiles[filename] = fileObj.content;
      }
    } else if (fs.existsSync(trimmedSource)) {
      const stat = fs.statSync(trimmedSource);
      let manifestPath = trimmedSource;
      if (stat.isDirectory()) {
        manifestPath = path.join(trimmedSource, "smcp.json");
      }
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`smcp.json manifest not found at ${manifestPath}`);
      }
      const content = fs.readFileSync(manifestPath, "utf8");
      manifest = ManifestSchema.parse(JSON.parse(content));
    } else {
      throw new Error(`Unsupported source: ${source}. Must be a GitHub Gist URL or local path.`);
    }
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
  const requiredEnvList: RequiredEnv[] = [...(manifest.requiredEnv || [])];
  const knownKeys = new Set(requiredEnvList.map((r) => r.key));

  const scanForPlaceholders = (str: string, isSecret = false) => {
    const matches = str.matchAll(/\${([a-zA-Z0-9_]+)}/g);
    for (const m of matches) {
      const varName = m[1];
      if (!knownKeys.has(varName)) {
        knownKeys.add(varName);
        requiredEnvList.push({
          key: varName,
          description: `Environment variable (${varName})`,
          isSecret
        });
      }
    }
  };

  for (const sConf of Object.values(manifest.mcpServers || {})) {
    if (sConf.env) {
      for (const [k, v] of Object.entries(sConf.env)) {
        scanForPlaceholders(v, isSecretKey(k));
      }
    }
    if (sConf.args) {
      for (const arg of sConf.args) {
        scanForPlaceholders(arg, false);
      }
    }
    if (sConf.url) {
      scanForPlaceholders(sConf.url, false);
    }
  }

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
    for (const [sName, sConf] of servers) {
      console.log(`  - ${pc.bold(sName)}:`);
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
      console.log(`  - ${pc.bold(sk.name)}${sk.description ? `: ${sk.description}` : ""}`);
      if (sk.files && Object.keys(sk.files).length > 0) {
        console.log(`      ${pc.dim("Files:")} ${Object.keys(sk.files).join(", ")}`);
      }
    }
  }

  p.note(`To install this pack, run:\n  ${pc.cyan(`smcp install ${source}`)}`, "Ready to install?");
  p.outro("");

  return manifest;
}
