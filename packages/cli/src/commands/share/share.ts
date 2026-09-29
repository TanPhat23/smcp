import * as p from "@clack/prompts";
import pc from "picocolors";
import path from "node:path";
import {
  detectAgents,
  filterAgents,
  getAgentProfiles,
  getSharesHistory,
  readInstalledMcpServers,
  readInstalledPlugins,
  redactMcpServers,
  scanSkills,
  triggerHook,
  type Manifest,
  type McpServerConfig,
  type PluginEntry,
  type ShareCommandOptions,
  type SkillEntry
} from "@smcp/core";
import { bundlePluginFiles, bundleSkillFiles } from "./bundle.ts";
import { getAllShareProviders, getShareProvider } from "./providers/index.ts";

export type { ShareCommandOptions } from "@smcp/core";

export async function shareCommand(options?: ShareCommandOptions): Promise<void> {
  const isAgentMode = Boolean(options?.json);
  const isNonInteractive = Boolean(options?.json || options?.yes || !process.stdin.isTTY);

  if (!isAgentMode) {
    p.intro(pc.bgCyan(pc.black(" smcp — Share Skills & MCPs ")));
  }

  let agents = detectAgents();
  if (options?.agents && options.agents.length > 0) {
    agents = filterAgents(agents, options.agents);
  } else if (!isNonInteractive && agents.length > 1) {
    const pickedAgents = await p.groupMultiselect({
      message: "Select AI agent(s) to share from (e.g. OpenCode, Claude Code):",
      options: {
        "Select all / Deselect all": agents.map((ag) => ({
          value: ag.id,
          label: ag.name,
          hint: ag.id
        }))
      },
      initialValues: agents.map((ag) => ag.id),
      required: true
    });
    if (p.isCancel(pickedAgents)) {
      p.cancel("Operation cancelled.");
      return;
    }
    const pickedAgentIds = pickedAgents as string[];
    agents = agents.filter((ag) => pickedAgentIds.includes(ag.id));
  }
  if (agents.length === 0) {
    const errMsg = "No supported AI agents found on this machine.";
    if (isAgentMode) {
      console.error(JSON.stringify({ success: false, error: errMsg }));
    } else {
      p.cancel(errMsg);
    }
    return;
  }

  // 1. Collect all available MCP servers
  const profiles = getAgentProfiles();
  const availableServers: Record<string, McpServerConfig> = {};
  for (const agent of agents) {
    if (agent.mcpConfigPath) {
      const profile = profiles[agent.id];
      const servers = readInstalledMcpServers(
        agent.mcpConfigPath,
        profile?.mcpConfig?.key || "mcpServers"
      );
      Object.assign(availableServers, servers);
    }
  }

  // 2. Collect all available skills
  const availableSkills: SkillEntry[] = [];
  for (const agent of agents) {
    if (agent.skillsDirPath) {
      const skills = scanSkills(agent.skillsDirPath);
      for (const s of skills) {
        if (!availableSkills.some((existing) => existing.name === s.name)) {
          availableSkills.push(s);
        }
      }
    }
  }

  // 2b. Collect all available plugins
  const availablePlugins: PluginEntry[] = [];
  for (const agent of agents) {
    if (agent.pluginsConfigPath) {
      const profile = profiles[agent.id];
      const plugins = readInstalledPlugins(
        agent.pluginsConfigPath,
        profile?.plugins?.key,
        profile?.plugins?.format,
        profile?.plugins?.dirPaths
      );
      for (const pl of plugins) {
        const pName = typeof pl === "string" ? pl : pl.name;
        if (!availablePlugins.some((existing) => (typeof existing === "string" ? existing : existing.name) === pName)) {
          availablePlugins.push(pl);
        }
      }
    }
  }

  const serverNames = Object.keys(availableServers);
  if (serverNames.length === 0 && availableSkills.length === 0 && availablePlugins.length === 0) {
    const errMsg = "No MCP servers, skills, or plugins found to share.";
    if (isAgentMode) {
      console.error(JSON.stringify({ success: false, error: errMsg }));
    } else {
      p.cancel(errMsg);
    }
    return;
  }

  // 3. Select MCP servers
  let selectedServers: Record<string, McpServerConfig> = {};
  if (options?.servers !== undefined) {
    for (const name of options.servers) {
      if (availableServers[name]) {
        selectedServers[name] = availableServers[name];
      }
    }
  } else if (isNonInteractive && serverNames.length > 0) {
    selectedServers = { ...availableServers };
  } else if (serverNames.length > 0) {
    const picked = await p.groupMultiselect({
      message: "Select MCP Servers to include:",
      options: {
        "Select all / Deselect all": serverNames.map((name) => {
          const s = availableServers[name];
          let hint = s.command || s.url || "configured";
          if (s.command && s.args && s.args.length > 0) {
            hint = `${s.command} ${s.args.join(" ")}`;
          }
          return {
            value: name,
            label: name,
            hint
          };
        })
      },
      required: false
    });
    if (p.isCancel(picked)) {
      p.cancel("Operation cancelled.");
      return;
    }
    for (const name of picked as string[]) {
      if (availableServers[name]) {
        selectedServers[name] = availableServers[name];
      }
    }
  }

  // 4. Select skills
  let selectedSkills: SkillEntry[] = [];
  if (options?.skills !== undefined) {
    selectedSkills = availableSkills.filter((sk) => options.skills?.includes(sk.name));
  } else if (isNonInteractive && availableSkills.length > 0) {
    selectedSkills = [...availableSkills];
  } else if (availableSkills.length > 0) {
    const picked = await p.groupMultiselect({
      message: "Select Skills to include:",
      options: {
        "Select all / Deselect all": availableSkills.map((sk) => ({
          value: sk.name,
          label: sk.name,
          hint: sk.path
        }))
      },
      required: false
    });
    if (p.isCancel(picked)) {
      p.cancel("Operation cancelled.");
      return;
    }
    selectedSkills = availableSkills.filter((sk) => (picked as string[]).includes(sk.name));
  }

  // 4b. Select plugins
  let selectedPlugins: PluginEntry[] = [];
  if (options?.plugins !== undefined) {
    selectedPlugins = availablePlugins.filter((pl) => {
      const name = typeof pl === "string" ? pl : pl.name;
      return options.plugins?.includes(name);
    });
  } else if (isNonInteractive && availablePlugins.length > 0) {
    selectedPlugins = [...availablePlugins];
  } else if (availablePlugins.length > 0) {
    const picked = await p.groupMultiselect({
      message: "Select Plugins to include:",
      options: {
        "Select all / Deselect all": availablePlugins.map((pl) => {
          const name = typeof pl === "string" ? pl : pl.name;
          const target = typeof pl === "object" && pl.targetAgent ? `[${pl.targetAgent}]` : "";
          const hint = typeof pl === "object" && pl.path ? pl.path : target || "plugin";
          return {
            value: name,
            label: name,
            hint
          };
        })
      },
      required: false
    });
    if (p.isCancel(picked)) {
      p.cancel("Operation cancelled.");
      return;
    }
    const pickedNames = picked as string[];
    selectedPlugins = availablePlugins.filter((pl) => {
      const name = typeof pl === "string" ? pl : pl.name;
      return pickedNames.includes(name);
    });
  }

  if (
    Object.keys(selectedServers).length === 0 &&
    selectedSkills.length === 0 &&
    selectedPlugins.length === 0
  ) {
    const errMsg = "No items selected.";
    if (isAgentMode) {
      console.error(JSON.stringify({ success: false, error: errMsg }));
    } else {
      p.cancel(errMsg);
    }
    return;
  }

  // 5. Redact secrets
  let sRedact: any;
  if (!isAgentMode) {
    sRedact = p.spinner();
    sRedact.start("Analyzing and redacting sensitive credentials...");
  }
  const redactorOptions = {
    extraKeyPatterns: options?.secretKeys,
    extraValuePatterns: options?.secretValues,
    excludeKeyPatterns: options?.excludeSecretKeys
  };
  const { redactedServers, requiredEnv } = redactMcpServers(selectedServers, redactorOptions);
  if (sRedact) {
    sRedact.stop(pc.green(`✔ Redacted secrets. Generated ${requiredEnv.length} environment placeholders.`));
  }

  // 6. Pack Details
  let packName = options?.name;
  if (!packName) {
    if (!process.stdin.isTTY) {
      packName = "my-agent-pack";
    } else {
      const answer = await p.text({
        message: "Pack name:",
        defaultValue: "my-agent-pack",
        placeholder: "my-agent-pack",
        validate: (val) => {
          if (!val || !val.trim()) return "Pack name is required";
          if (!/^[a-zA-Z0-9_-]+$/.test(val.trim())) {
            return "Must be alphanumeric (hyphens/underscores allowed)";
          }
          return undefined;
        }
      });
      if (p.isCancel(answer) || typeof answer !== "string") {
        p.cancel("Operation cancelled.");
        return;
      }
      packName = answer;
    }
  } else {
    if (!/^[a-zA-Z0-9_-]+$/.test(packName.trim())) {
      const errMsg = "Pack name must be alphanumeric (hyphens and underscores allowed).";
      if (isAgentMode) {
        console.error(JSON.stringify({ success: false, error: errMsg }));
      } else {
        p.cancel(errMsg);
      }
      return;
    }
  }
  const cleanPackName = packName.trim();

  let packDesc = options?.description;
  if (packDesc === undefined) {
    if (!process.stdin.isTTY) {
      packDesc = "Shared Skills and MCP stack";
    } else {
      const answer = await p.text({
        message: "Pack description:",
        defaultValue: "Shared Skills and MCP stack",
        placeholder: "Shared Skills and MCP stack"
      });
      if (p.isCancel(answer) || typeof answer !== "string") {
        p.cancel("Operation cancelled.");
        return;
      }
      packDesc = typeof answer === "string" ? answer : "Shared Skills and MCP stack";
    }
  }
  const cleanPackDesc = (packDesc && packDesc.trim()) || "Shared Skills and MCP stack";

  // 6b. Resolve target share provider
  let targetProvider: "gist" | "repo" | "local" = "gist";
  let targetLocalOutDir: string | undefined = undefined;
  let targetRepoInput: string | undefined = options?.repo;

  if (options?.output) {
    targetProvider = "local";
    targetLocalOutDir = path.resolve(options.output);
  } else if (options?.repo) {
    targetProvider = "repo";
    targetRepoInput = options.repo.trim();
  } else if (options?.provider) {
    const resolvedProvider = getShareProvider(options.provider);
    if (!resolvedProvider) {
      const supported = getAllShareProviders().map((p) => p.id).join(", ");
      const errMsg = `Unsupported provider: ${options.provider}. Supported providers: ${supported}.`;
      if (isAgentMode) {
        console.error(JSON.stringify({ success: false, error: errMsg }));
      } else {
        p.cancel(errMsg);
      }
      return;
    }
    targetProvider = resolvedProvider.id as "gist" | "repo" | "local";
    if (targetProvider === "local") {
      targetLocalOutDir = path.resolve(`./${cleanPackName}`);
    }
  } else if (isNonInteractive) {
    targetProvider = "gist";
  } else {
    const availableProviders = getAllShareProviders();
    const providerPrompt = await p.select({
      message: "Choose share provider:",
      options: availableProviders.map((pr) => ({
        value: pr.id,
        label: pr.label,
        hint: pr.hint
      })),
      initialValue: "gist"
    });
    if (p.isCancel(providerPrompt)) {
      p.cancel("Operation cancelled.");
      return;
    }
    targetProvider = providerPrompt as "gist" | "repo" | "local";

    if (targetProvider === "local") {
      const dirPrompt = await p.text({
        message: "Export folder path:",
        defaultValue: `./${cleanPackName}`,
        placeholder: `./${cleanPackName}`,
        validate: (val) => (!val || !val.trim() ? "Folder path is required" : undefined)
      });
      if (p.isCancel(dirPrompt) || typeof dirPrompt !== "string") {
        p.cancel("Operation cancelled.");
        return;
      }
      targetLocalOutDir = path.resolve(dirPrompt.trim());
    } else if (targetProvider === "repo" && !targetRepoInput) {
      const repoPrompt = await p.text({
        message: "GitHub repository name (e.g. my-agent-pack or owner/my-agent-pack):",
        defaultValue: cleanPackName,
        placeholder: cleanPackName,
        validate: (val) => (!val || !val.trim() ? "Repository name is required" : undefined)
      });
      if (p.isCancel(repoPrompt) || typeof repoPrompt !== "string") {
        p.cancel("Operation cancelled.");
        return;
      }
      targetRepoInput = repoPrompt.trim();
    }
  }

  // 7. Check existing shares & version bump
  const history = getSharesHistory();
  const existingShare = history.shares.find((s) => s.name === cleanPackName);
  let version = "1.0.0";
  let targetGistId: string | undefined = undefined;

  if (existingShare) {
    const parts = existingShare.version.split(".").map(Number);
    const nextPatch =
      parts.length === 3 && parts.every((n) => !isNaN(n))
        ? `${parts[0]}.${parts[1]}.${parts[2] + 1}`
        : "1.0.1";

    const destInfo =
      existingShare.targetType === "gist"
        ? `Gist: ${existingShare.targetUrl}`
        : existingShare.targetType === "repo"
        ? `Repository: ${existingShare.targetUrl}`
        : `Local directory: ${existingShare.targetUrl}`;

    if (options?.name !== undefined || !process.stdin.isTTY) {
      version = nextPatch;
      if (targetProvider === "gist") {
        targetGistId = existingShare.gistId;
      }
    } else {
      const action = await p.select({
        message: `Pack '${cleanPackName}' was previously shared (v${existingShare.version} to ${destInfo}). How to proceed?`,
        options: [
          {
            value: "update",
            label: `Update existing share (bumps to v${nextPatch})`,
            hint: destInfo
          },
          { value: "new", label: "Create new standalone share (resets to v1.0.0)" }
        ]
      });
      if (p.isCancel(action)) {
        p.cancel("Operation cancelled.");
        return;
      }

      if (action === "update") {
        version = nextPatch;
        if (targetProvider === "gist") {
          targetGistId = existingShare.gistId;
        }
        if (targetProvider === "repo" && !targetRepoInput && existingShare.repoFullName) {
          targetRepoInput = existingShare.repoFullName;
        }
      } else {
        version = "1.0.0";
      }
    }
  }

  // 8. Bundle skill & plugin files
  const { bundledSkills, gistFiles: skillGistFiles } = bundleSkillFiles(selectedSkills);
  const { bundledPlugins, gistFiles: pluginGistFiles } = await bundlePluginFiles(selectedPlugins);
  const gistFiles: Record<string, { content: string }> = { ...skillGistFiles, ...pluginGistFiles };

  const manifest: Manifest = {
    $schema: "https://smcp.dev/schema.json",
    name: cleanPackName,
    version,
    description: cleanPackDesc,
    createdAt: existingShare?.lastSharedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mcpServers: redactedServers,
    skills: bundledSkills,
    plugins: bundledPlugins,
    requiredEnv
  };

  gistFiles["smcp.json"] = { content: JSON.stringify(manifest, null, 2) };

  // 9. Publish via resolved ShareProvider
  const provider = getShareProvider(targetProvider);
  if (!provider) {
    const errMsg = `Unknown share provider: ${targetProvider}`;
    if (isAgentMode) {
      console.error(JSON.stringify({ success: false, error: errMsg }));
    } else {
      p.cancel(errMsg);
    }
    return;
  }

  try {
    await triggerHook("beforeShare", {
      manifest,
      selectedServers,
      selectedSkills,
      selectedPlugins,
      redactedServers,
      requiredEnv,
      options,
      isAgentMode,
      isNonInteractive
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (isAgentMode) {
      console.error(JSON.stringify({ success: false, error: message }));
    } else {
      p.cancel(message);
    }
    return;
  }

  const publishResult = await provider.publish({
    manifest,
    bundledSkills,
    bundledPlugins,
    redactedServers,
    selectedServers,
    selectedSkills,
    selectedPlugins,
    gistFiles,
    options,
    isNonInteractive,
    isAgentMode,
    version,
    cleanPackName,
    cleanPackDesc,
    targetGistId,
    targetRepoInput,
    targetLocalOutDir
  });

  try {
    await triggerHook("afterShare", {
      manifest,
      targetProvider,
      result: publishResult,
      options,
      isAgentMode,
      isNonInteractive
    });
  } catch (hookErr: unknown) {
    const msg = hookErr instanceof Error ? hookErr.message : String(hookErr);
    if (!isAgentMode) {
      p.log.warn(pc.yellow(`Warning: afterShare hook encountered an error: ${msg}`));
    } else {
      console.warn(JSON.stringify({ warning: `afterShare hook error: ${msg}` }));
    }
  }
}
