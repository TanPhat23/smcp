import * as p from "@clack/prompts";
import pc from "picocolors";
import { GitHubClient } from "../../../core/github.ts";
import { getAuthConfig, recordShare } from "../../../core/state/index.ts";
import { hashObject } from "../../../utils/crypto.ts";
import { authLoginCommand } from "../../auth/login.ts";
import type { ShareProvider, ShareProviderContext } from "./types.ts";

export class GistShareProvider implements ShareProvider {
  readonly id = "gist";
  readonly label = "GitHub Gist";
  readonly hint = "Publish to GitHub Gist online (public or secret)";

  async publish(context: ShareProviderContext): Promise<boolean | void> {
    const {
      bundledSkills,
      bundledPlugins,
      redactedServers,
      selectedServers,
      selectedSkills,
      selectedPlugins,
      gistFiles,
      options,
      cleanPackName,
      cleanPackDesc,
      version,
      targetGistId,
      isNonInteractive,
      isAgentMode
    } = context;

    let auth = getAuthConfig();
    if (!auth.githubToken) {
      if (isNonInteractive) {
        const errMsg =
          "Cannot publish to GitHub Gist without authentication. Run 'smcp auth login' or export locally with --output <dir>.";
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
          return false;
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
        return true;
      }

      if (sPub) {
        sPub.stop(pc.green(`✔ Pack published: ${pc.bold(resultUrl)}`));
      }

      p.note(
        `Install this pack on any machine using:\n  ${pc.cyan(`smcp install ${resultUrl}`)}`,
        "Share Link"
      );
      p.outro(pc.green("Pack shared successfully!"));
      return true;
    } catch (err: unknown) {
      const errMsg = `Failed to publish Gist: ${err instanceof Error ? err.message : String(err)}`;
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
