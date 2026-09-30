import * as p from "@clack/prompts";
import pc from "picocolors";
import path from "node:path";
import { generatePackReadme, getAuthConfig, GitHubClient, hashObject, recordShare } from "@tanphat/smcp-core";
import { authLoginCommand } from "../../auth/login.ts";
import { GistShareProvider } from "./gist.ts";
import { LocalShareProvider } from "./local.ts";
import type { ShareProvider, ShareProviderContext } from "./types.ts";

export class RepoShareProvider implements ShareProvider {
  readonly id = "repo";
  readonly label = "GitHub Repository";
  readonly hint = "Publish to a GitHub repository (creates or updates repo)";

  async publish(context: ShareProviderContext): Promise<boolean | void> {
    const {
      manifest,
      bundledSkills,
      bundledPlugins,
      redactedServers,
      selectedServers,
      selectedSkills,
      selectedPlugins,
      options,
      cleanPackName,
      cleanPackDesc,
      version,
      targetRepoInput,
      isNonInteractive,
      isAgentMode
    } = context;

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
        return false;
      }
      await authLoginCommand();
      auth = getAuthConfig();
      if (!auth.githubToken) {
        p.cancel("Cannot publish without GitHub token.");
        return false;
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
      return false;
    }

    // Permission scope check: if token lacks repo permissions
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
        return false;
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
        return false;
      }

      if (recoveryChoice === "gist") {
        const gistProvider = new GistShareProvider();
        return await gistProvider.publish(context);
      } else if (recoveryChoice === "local") {
        const dirPrompt = await p.text({
          message: "Export folder path:",
          defaultValue: `./${cleanPackName}`,
          placeholder: `./${cleanPackName}`,
          validate: (val) => (!val || !val.trim() ? "Folder path is required" : undefined)
        });
        if (p.isCancel(dirPrompt) || typeof dirPrompt !== "string") {
          p.cancel("Operation cancelled.");
          return false;
        }
        const localProvider = new LocalShareProvider();
        return await localProvider.publish({
          ...context,
          targetLocalOutDir: path.resolve(dirPrompt.trim())
        });
      } else if (recoveryChoice === "reauth") {
        await authLoginCommand();
        auth = getAuthConfig();
        if (!auth.githubToken) {
          p.cancel("Cannot publish without GitHub token.");
          return false;
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
          return false;
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
        return true;
      }

      if (sPub) {
        sPub.stop(pc.green(`✔ Pack successfully published to GitHub Repository: ${res.html_url}`));
      }
      p.outro(pc.cyan(`Install via: smcp install ${res.html_url}`));
      return true;
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
      return false;
    }
  }
}
