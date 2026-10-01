import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import {
  collectRequiredEnv,
  detectAgents,
  getAgentProfiles,
  loadPackFromSource,
  readInstalledMcpServers,
  resolveActiveAgentPath,
  triggerHook,
  type InstallCommandOptions,
  type Manifest
} from "@tanphat/smcp-core";
import { installPackIntoAgents } from "./agents.ts";
import { resolveMcpServerTemplates } from "./templates.ts";

export type { InstallCommandOptions } from "@tanphat/smcp-core";

export async function installCommand(
  source: string,
  options?: InstallCommandOptions
): Promise<void> {
  const isAgentMode = Boolean(options?.json);

  if (!isAgentMode) {
    p.intro(pc.bgCyan(pc.black(" smcp — Install Agent Pack ")));
  }

  let sFetch: any;
  if (!isAgentMode) {
    sFetch = p.spinner();
    sFetch.start(`Fetching pack from ${source}...`);
  }

  let manifest: Manifest;
  let rawFiles: Record<string, string> = {};
  let localDir: string | undefined = undefined;

  try {
    const loaded = await loadPackFromSource(source);
    manifest = loaded.manifest;
    rawFiles = loaded.rawFiles;
    localDir = loaded.localDir;
    if (sFetch) {
      sFetch.stop(pc.green(`✔ Loaded pack: ${pc.bold(manifest.name)} (v${manifest.version})`));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (sFetch) {
      sFetch.stop(pc.red("✖ Could not load pack"));
    }
    if (isAgentMode) {
      console.error(JSON.stringify({ success: false, error: message }));
    } else {
      p.cancel(message);
    }
    return;
  }

  // Display summary if interactive
  if (!isAgentMode) {
    const mcpNames = Object.keys(manifest.mcpServers || {});
    const skillNames = (manifest.skills || []).map((s) => s.name);
    const pluginNames = (manifest.plugins || []).map((p) => (typeof p === "string" ? p : p.name));
    console.log(`\n${pc.bold("Description:")} ${manifest.description || "(none)"}`);
    console.log(`${pc.bold("MCP Servers:")} ${mcpNames.join(", ") || "(none)"}`);
    console.log(`${pc.bold("Skills:")} ${skillNames.join(", ") || "(none)"}`);
    console.log(`${pc.bold("Plugins:")} ${pluginNames.join(", ") || "(none)"}`);
  }

  // Select target agents
  const detected = detectAgents();
  const allProfiles = getAgentProfiles();

  if (Object.keys(allProfiles).length === 0) {
    if (isAgentMode) {
      console.error(JSON.stringify({ success: false, error: "No agent profiles configured." }));
    } else {
      p.cancel("No agent profiles configured.");
    }
    return;
  }

  let targetAgentIds: string[] = [];
  if (options?.agents && options.agents.length > 0) {
    const rawList = options.agents
      .flatMap((a) => a.split(","))
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);
    targetAgentIds = Object.keys(allProfiles).filter((id) => {
      const profName = allProfiles[id].name.toLowerCase();
      return rawList.some((t) => {
        if (id.toLowerCase() === t || profName === t) return true;
        if (t === "claude" && (id.startsWith("claude-") || id === "claude")) return true;
        if (t === "opencode" && id === "opencode") return true;
        return id.toLowerCase().includes(t) || profName.includes(t);
      });
    });
    if (targetAgentIds.length === 0) {
      const errMsg = "None of the specified target agents were recognized.";
      if (isAgentMode) {
        console.error(JSON.stringify({ success: false, error: errMsg }));
      } else {
        p.cancel(errMsg);
      }
      return;
    }
  } else if (options?.json || options?.yes) {
    targetAgentIds = detected.length > 0 ? detected.map((d) => d.id) : Object.keys(allProfiles).slice(0, 1);
  } else {
    const picked = await p.multiselect({
      message: "Select AI agent(s) to install into:",
      options: Object.entries(allProfiles).map(([id, prof]) => {
        const isDet = detected.some((d) => d.id === id);
        return {
          value: id,
          label: prof.name,
          hint: isDet ? "detected" : "configured"
        };
      }),
      required: true
    });
    if (p.isCancel(picked)) {
      p.cancel("Installation cancelled.");
      return;
    }
    targetAgentIds = picked as string[];
  }

  if (targetAgentIds.length === 0) {
    const errMsg = "No target agents selected.";
    if (isAgentMode) {
      console.error(JSON.stringify({ success: false, error: errMsg }));
    } else {
      p.cancel(errMsg);
    }
    return;
  }

  // Handle Required Environment Variables & Template Placeholders
  const envValues: Record<string, string> = { ...(options?.env || {}) };
  const requiredEnvList = collectRequiredEnv(manifest);

  const missingEnvList = requiredEnvList.filter((req) => envValues[req.key] === undefined);

  if (missingEnvList.length > 0) {
    const unresolved: typeof missingEnvList = [];
    for (const req of missingEnvList) {
      if (process.env[req.key]) {
        envValues[req.key] = process.env[req.key]!;
        if (!isAgentMode) {
          p.log.info(`Using existing environment variable for ${pc.cyan(req.key)}`);
        }
      } else {
        unresolved.push(req);
      }
    }

    if (unresolved.length > 0) {
      if (options?.json || options?.yes) {
        const missingKeys = unresolved.map((r) => r.key);
        const errMsg = `Missing required environment variable(s): ${missingKeys.join(", ")}. Provide them via environment or --env KEY=VALUE.`;
        if (isAgentMode) {
          console.error(
            JSON.stringify({
              success: false,
              error: errMsg,
              missingEnv: missingKeys
            })
          );
        } else {
          p.cancel(errMsg);
        }
        return;
      }

      p.note("This pack requires environment variables for credentials/URLs.", "Environment Setup");
      for (const req of unresolved) {
        const promptFn = req.isSecret ? p.password : p.text;
        const answer = await promptFn({
          message: `${req.key} (${req.description || "required value"}):`,
          validate: (val) => (!val || !val.trim() ? `${req.key} is required` : undefined)
        });
        if (p.isCancel(answer) || typeof answer !== "string") {
          p.cancel("Installation cancelled.");
          return;
        }
        envValues[req.key] = answer.trim();
      }
    }
  }

  // Resolve templated MCP servers (including env, args, and url)
  const resolvedServers = resolveMcpServerTemplates(manifest.mcpServers || {}, envValues);

  // Check conflicts across target agents if not forced
  if (!options?.force && !options?.yes && !options?.json) {
    let hasConflicts = false;
    for (const agentId of targetAgentIds) {
      const profile = allProfiles[agentId];
      if (!profile) continue;

      if (profile.mcpConfig && profile.mcpConfig.paths && profile.mcpConfig.paths.length > 0) {
        const pPath = resolveActiveAgentPath(profile.mcpConfig.paths);
        if (pPath) {
          const currentServers = readInstalledMcpServers(pPath, profile.mcpConfig.key || "mcpServers");
          for (const sName of Object.keys(resolvedServers)) {
            if (currentServers[sName]) {
              hasConflicts = true;
              break;
            }
          }
        }
      }
      if (hasConflicts) break;

      if (profile.skills && profile.skills.paths && profile.skills.paths.length > 0 && manifest.skills) {
        const sPath = resolveActiveAgentPath(profile.skills.paths);
        if (sPath) {
          for (const sk of manifest.skills) {
            if (fs.existsSync(path.join(sPath, sk.name))) {
              hasConflicts = true;
              break;
            }
          }
        }
      }
      if (hasConflicts) break;
    }

    if (hasConflicts) {
      const confirmOverwrite = await p.confirm({
        message: "Some MCP servers or skills already exist in the target agent(s). Overwrite existing configurations?",
        initialValue: true
      });
      if (p.isCancel(confirmOverwrite)) {
        p.cancel("Installation cancelled.");
        return;
      }
      if (!confirmOverwrite) {
        p.cancel("Installation cancelled by user.");
        return;
      }
    }
  }

  // Perform Installation
  let sInst: any;
  if (!isAgentMode) {
    sInst = p.spinner();
    sInst.start("Installing skills and configuring MCP servers...");
  }

  try {
    await triggerHook("beforeInstall", {
      source,
      manifest,
      targetAgentIds,
      resolvedServers,
      options,
      isAgentMode
    });

    const result = installPackIntoAgents(
      manifest,
      targetAgentIds,
      resolvedServers,
      rawFiles,
      localDir,
      allProfiles,
      options?.pluginDir,
      options?.runtime
    );

    try {
      await triggerHook("afterInstall", {
        source,
        manifest,
        targetAgentIds,
        installedMcp: result.installedMcp,
        installedSkills: result.installedSkills,
        installedPlugins: result.installedPlugins,
        options,
        isAgentMode
      });
    } catch (hookErr: unknown) {
      const msg = hookErr instanceof Error ? hookErr.message : String(hookErr);
      if (!isAgentMode) {
        p.log.warn(pc.yellow(`Warning: afterInstall hook encountered an error: ${msg}`));
      } else {
        console.warn(JSON.stringify({ warning: `afterInstall hook error: ${msg}` }));
      }
    }

    if (isAgentMode) {
      console.log(
        JSON.stringify(
          {
            success: true,
            pack: manifest.name,
            version: manifest.version,
            targetAgents: targetAgentIds,
            installedMcp: Object.keys(resolvedServers),
            installedSkills: (manifest.skills || []).map((s) => s.name),
            installedPlugins: (manifest.plugins || []).map((p) => (typeof p === "string" ? p : p.name))
          },
          null,
          2
        )
      );
      return;
    }

    if (sInst) {
      sInst.stop(pc.green("✔ Installation completed!"));
    }
    p.outro(pc.green(`Pack '${manifest.name}' is now active in: ${targetAgentIds.join(", ")}`));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (sInst) {
      sInst.stop(pc.red("✖ Installation failed"));
    }
    if (isAgentMode) {
      console.error(JSON.stringify({ success: false, error: message }));
    } else {
      p.cancel(message);
    }
  }
}
