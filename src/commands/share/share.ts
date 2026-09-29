import * as p from "@clack/prompts";
import pc from "picocolors";
import path from "node:path";
import {
  detectAgents,
  filterAgents,
  getAgentProfiles,
  readInstalledMcpServers,
  readInstalledPlugins,
  scanSkills
} from "../../core/agents/index.ts";
import { GitHubClient, generatePackReadme } from "../../core/github.ts";
import { redactMcpServers } from "../../core/redactor/index.ts";
import { getAuthConfig, getSharesHistory, recordShare } from "../../core/state/index.ts";
import type { Manifest, McpServerConfig, PluginEntry, SkillEntry } from "../../types/index.ts";
import { hashObject } from "../../utils/crypto.ts";
import { authLoginCommand } from "../auth/index.ts";
import { bundlePluginFiles, bundleSkillFiles } from "./bundle.ts";
import { exportPackLocally } from "./export.ts";

export interface ShareCommandOptions {
  provider?: "gist" | "repo" | "local" | string;
  repo?: string;
  branch?: string;
  output?: string;
  name?: string;
  description?: string;
  servers?: string[];
  skills?: string[];
  plugins?: string[];
  agents?: string[];
  isPublic?: boolean;
  public?: boolean;
  settings?: boolean;
  json?: boolean;
  yes?: boolean;
  secretKeys?: string[];
  secretValues?: string[];
  excludeSecretKeys?: string[];
}

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
    const pChoice = options.provider.trim().toLowerCase();
    if (pChoice !== "gist" && pChoice !== "repo" && pChoice !== "local") {
      const errMsg = `Unsupported provider: ${options.provider}. Supported providers: gist, repo, local.`;
      if (isAgentMode) {
        console.error(JSON.stringify({ success: false, error: errMsg }));
      } else {
        p.cancel(errMsg);
      }
      return;
    }
    targetProvider = pChoice as "gist" | "repo" | "local";
    if (targetProvider === "local") {
      targetLocalOutDir = path.resolve(`./${cleanPackName}`);
    }
  } else if (isNonInteractive) {
    targetProvider = "gist";
  } else {
    const providerPrompt = await p.select({
      message: "Choose share provider:",
      options: [
        {
          value: "gist",
          label: "GitHub Gist",
          hint: "Publish to GitHub Gist online (public or secret)"
        },
        {
          value: "repo",
          label: "GitHub Repository",
          hint: "Publish to a GitHub repository (creates or updates repo)"
        },
        {
          value: "local",
          label: "Local Directory",
          hint: "Export pack directly to a local folder"
        }
      ],
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

  // 9. Local export if targetProvider === "local"
  if (targetProvider === "local") {
    const outDir = targetLocalOutDir || path.resolve(`./${cleanPackName}`);
    exportPackLocally(manifest, bundledSkills, outDir, bundledPlugins);

    const serverFingerprints: Record<string, string> = {};
    for (const [k, v] of Object.entries(redactedServers)) {
      serverFingerprints[k] = hashObject(v);
    }
    const skillFingerprints: Record<string, string> = {};
    for (const sk of bundledSkills) {
      skillFingerprints[sk.name] = sk.contentHash || "";
    }

    recordShare({
      name: cleanPackName,
      version,
      targetType: "local",
      targetUrl: outDir,
      lastSharedAt: new Date().toISOString(),
      fingerprints: {
        mcpServers: serverFingerprints,
        skills: skillFingerprints
      }
    });

    if (isAgentMode) {
      console.log(
        JSON.stringify(
          {
            success: true,
            pack: cleanPackName,
            version,
            type: "local",
            provider: "local",
            location: outDir,
            servers: Object.keys(selectedServers),
            skills: selectedSkills.map((s) => s.name),
            plugins: selectedPlugins.map((p) => (typeof p === "string" ? p : p.name))
          },
          null,
          2
        )
      );
      return;
    }

    p.outro(pc.green(`✔ Pack successfully exported to ${outDir}`));
    return;
  }

  // 9b. GitHub Repository Publishing
  if (targetProvider === "repo") {
    let auth = getAuthConfig();
    if (!auth.githubToken) {
      if (isNonInteractive) {
        const errMsg =
          "Cannot publish to GitHub repository without authentication. Run 'smcp auth login' or export locally with --output <dir>.";
        if (isAgentMode) {
          console.error(JSON.stringify({ success: false, error: errMsg }));
        } else {
          p.cancel(errMsg);
        }
        return;
      }
      await authLoginCommand();
      auth = getAuthConfig();
      if (!auth.githubToken) {
        p.cancel("Cannot publish without GitHub token.");
        return;
      }
    }

    let client = new GitHubClient(auth.githubToken);
    let userLogin = "";
    let userScopes: string[] | undefined;
    try {
      const user = await client.verifyUser();
      userLogin = user.login;
      userScopes = user.scopes;
    } catch (err: unknown) {
      const errMsg = `GitHub Authentication failed: ${err instanceof Error ? err.message : String(err)}`;
      if (isAgentMode) {
        console.error(JSON.stringify({ success: false, error: errMsg }));
      } else {
        p.cancel(errMsg);
      }
      return;
    }

    // Permission scope check: if user has classic/OAuth token without repo permissions
    if (
      userScopes &&
      userScopes.length > 0 &&
      !userScopes.includes("repo") &&
      !userScopes.includes("public_repo")
    ) {
      const warnMsg = `Your current token has scopes [${userScopes.join(", ")}], which lacks the 'repo' scope required to publish repositories.`;

      if (isNonInteractive) {
        const errMsg = `${warnMsg}\nTo fix: run 'smcp auth login' with a token having 'repo' scope, or share to Gist via '-P gist' or local via '-o <dir>'.`;
        if (isAgentMode) {
          console.error(JSON.stringify({ success: false, error: errMsg }));
        } else {
          p.cancel(errMsg);
        }
        return;
      }

      p.log.warn(pc.yellow(warnMsg));
      const recoveryChoice = await p.select({
        message: "How would you like to proceed?",
        options: [
          {
            value: "gist",
            label: "Fallback to GitHub Gist (Recommended)",
            hint: "Works with your current 'gist' token"
          },
          {
            value: "reauth",
            label: "Re-authenticate now with a token that has 'repo' scope",
            hint: "Opens prompt to enter updated PAT"
          },
          {
            value: "local",
            label: "Export pack to a local directory instead",
            hint: "Saves files to disk without GitHub upload"
          }
        ]
      });

      if (p.isCancel(recoveryChoice)) {
        p.cancel("Operation cancelled.");
        return;
      }

      if (recoveryChoice === "gist") {
        targetProvider = "gist";
      } else if (recoveryChoice === "local") {
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
        const outDir = path.resolve(dirPrompt.trim());
        exportPackLocally(manifest, bundledSkills, outDir, bundledPlugins);

        const serverFingerprints: Record<string, string> = {};
        for (const [k, v] of Object.entries(redactedServers)) {
          serverFingerprints[k] = hashObject(v);
        }
        const skillFingerprints: Record<string, string> = {};
        for (const sk of bundledSkills) {
          skillFingerprints[sk.name] = sk.contentHash || "";
        }

        recordShare({
          name: cleanPackName,
          version,
          targetType: "local",
          targetUrl: outDir,
          lastSharedAt: new Date().toISOString(),
          fingerprints: {
            mcpServers: serverFingerprints,
            skills: skillFingerprints
          }
        });

        p.outro(pc.green(`✔ Pack successfully exported to ${outDir}`));
        return;
      } else if (recoveryChoice === "reauth") {
        await authLoginCommand();
        auth = getAuthConfig();
        if (!auth.githubToken) {
          p.cancel("Cannot publish without GitHub token.");
          return;
        }
        client = new GitHubClient(auth.githubToken);
        try {
          const user = await client.verifyUser();
          userLogin = user.login;
        } catch {
          // continue with input
        }
      }
    }

    if (targetProvider === "repo") {
      let repoFullName = targetRepoInput || cleanPackName;
      let owner = userLogin;
      let repoName = repoFullName;
      if (repoFullName.includes("/")) {
        const parts = repoFullName.split("/");
        owner = parts[0];
        repoName = parts[1];
      } else {
        repoFullName = `${owner}/${repoName}`;
      }

      let isPublic = options?.isPublic ?? options?.public;
      if (isPublic === undefined) {
        if (isNonInteractive) {
          isPublic = true;
        } else {
          const answer = await p.confirm({
            message: `Make repository ${repoFullName} public? (No = private repository)`,
            initialValue: true
          });
          if (p.isCancel(answer)) {
            p.cancel("Operation cancelled.");
            return;
          }
          isPublic = Boolean(answer);
        }
      }

      let sPub: any;
      if (!isAgentMode) {
        sPub = p.spinner();
        sPub.start(`Publishing pack to GitHub repository ${repoFullName}...`);
      }

      try {
        const repoFiles: Record<string, string> = {
          "smcp.json": JSON.stringify(manifest, null, 2) + "\n",
          "README.md": generatePackReadme(manifest, repoFullName)
        };

        for (const sk of bundledSkills) {
          if (sk.files) {
            for (const [fn, cnt] of Object.entries(sk.files)) {
              repoFiles[`skills/${sk.name}/${fn.replaceAll("\\", "/")}`] = cnt;
            }
          }
        }

        for (const pl of bundledPlugins) {
          if (typeof pl === "object" && pl.files) {
            for (const [fn, cnt] of Object.entries(pl.files)) {
              repoFiles[`plugins/${pl.name}/${fn.replaceAll("\\", "/")}`] = cnt;
            }
          }
        }

        const res = await client.commitFilesToRepo({
          owner,
          repo: repoName,
          branch: options?.branch,
          message: `[smcp] ${cleanPackName} v${version} - ${cleanPackDesc}`,
          files: repoFiles,
          isPublic,
          description: cleanPackDesc
        });

        const serverFingerprints: Record<string, string> = {};
        for (const [k, v] of Object.entries(redactedServers)) {
          serverFingerprints[k] = hashObject(v);
        }
        const skillFingerprints: Record<string, string> = {};
        for (const sk of bundledSkills) {
          skillFingerprints[sk.name] = sk.contentHash || "";
        }

        recordShare({
          name: cleanPackName,
          version,
          targetType: "repo",
          targetUrl: res.html_url,
          repoFullName,
          lastSharedAt: new Date().toISOString(),
          fingerprints: {
            mcpServers: serverFingerprints,
            skills: skillFingerprints
          }
        });

        if (isAgentMode) {
          console.log(
            JSON.stringify(
              {
                success: true,
                pack: cleanPackName,
                version,
                type: "repo",
                provider: "repo",
                url: res.html_url,
                repo: repoFullName,
                commit: res.commitSha,
                branch: res.branch,
                servers: Object.keys(selectedServers),
                skills: selectedSkills.map((s) => s.name),
                plugins: selectedPlugins.map((p) => (typeof p === "string" ? p : p.name))
              },
              null,
              2
            )
          );
          return;
        }

        if (sPub) {
          sPub.stop(pc.green(`✔ Pack successfully published to GitHub Repository: ${res.html_url}`));
        }
        p.outro(pc.cyan(`Install via: smcp install ${res.html_url}`));
        return;
      } catch (err: unknown) {
        const errMsg = `Failed to publish repository: ${err instanceof Error ? err.message : String(err)}`;
        if (sPub) {
          sPub.stop(pc.red("✖ Publish failed."));
        }
        if (isAgentMode) {
          console.error(JSON.stringify({ success: false, error: errMsg }));
        } else {
          p.cancel(errMsg);
        }
        return;
      }
    }
  }

  // 10. GitHub Gist Publishing
  let auth = getAuthConfig();
  if (!auth.githubToken) {
    if (isNonInteractive) {
      const errMsg = "Cannot publish to GitHub Gist without authentication. Run 'smcp auth login' or export locally with --output <dir>.";
      if (isAgentMode) {
        console.error(JSON.stringify({ success: false, error: errMsg }));
      } else {
        p.cancel(errMsg);
      }
      return;
    }
    await authLoginCommand();
    auth = getAuthConfig();
    if (!auth.githubToken) {
      p.cancel("Cannot publish without GitHub token.");
      return;
    }
  }

  let isPublic = options?.isPublic;
  if (isPublic === undefined) {
    if (isNonInteractive) {
      isPublic = false;
    } else {
      const answer = await p.confirm({
        message: "Make Gist public? (No = secret unlisted Gist)",
        initialValue: true
      });
      if (p.isCancel(answer)) {
        p.cancel("Operation cancelled.");
        return;
      }
      isPublic = Boolean(answer);
    }
  }

  let sPub: any;
  if (!isAgentMode) {
    sPub = p.spinner();
    sPub.start("Publishing pack to GitHub Gist...");
  }

  try {
    const client = new GitHubClient(auth.githubToken);
    let resultUrl = "";
    let finalGistId = targetGistId;

    if (targetGistId) {
      const res = await client.updateGist(targetGistId, {
        description: `[smcp] ${cleanPackName} v${version} - ${cleanPackDesc}`,
        files: gistFiles
      });
      resultUrl = res.html_url;
    } else {
      const res = await client.createGist({
        description: `[smcp] ${cleanPackName} v${version} - ${cleanPackDesc}`,
        public: isPublic,
        files: gistFiles
      });
      resultUrl = res.html_url;
      finalGistId = res.id;
    }

    const serverFingerprints: Record<string, string> = {};
    for (const [k, v] of Object.entries(redactedServers)) {
      serverFingerprints[k] = hashObject(v);
    }
    const skillFingerprints: Record<string, string> = {};
    for (const sk of bundledSkills) {
      skillFingerprints[sk.name] = sk.contentHash || "";
    }

    recordShare({
      name: cleanPackName,
      version,
      targetType: "gist",
      targetUrl: resultUrl,
      gistId: finalGistId,
      lastSharedAt: new Date().toISOString(),
      fingerprints: {
        mcpServers: serverFingerprints,
        skills: skillFingerprints
      }
    });

    if (isAgentMode) {
      console.log(
        JSON.stringify(
          {
            success: true,
            pack: cleanPackName,
            version,
            type: "gist",
            location: resultUrl,
            gistId: finalGistId,
            servers: Object.keys(selectedServers),
            skills: selectedSkills.map((s) => s.name),
            plugins: selectedPlugins.map((p) => (typeof p === "string" ? p : p.name))
          },
          null,
          2
        )
      );
      return;
    }

    if (sPub) {
      sPub.stop(pc.green(`✔ Pack published: ${pc.bold(resultUrl)}`));
    }

    p.note(
      `Share this pack with anyone:\n  ${pc.cyan(`npx smcp install ${resultUrl}`)}`,
      "Share Command"
    );
    p.outro(pc.green("Done!"));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (sPub) {
      sPub.stop(pc.red("✖ Failed to publish pack"));
    }
    if (isAgentMode) {
      console.error(JSON.stringify({ success: false, error: message }));
    } else {
      p.cancel(message);
    }
  }
}
