import * as p from "@clack/prompts";
import pc from "picocolors";
import { GitHubClient } from "../../core/github.ts";
import { getAuthConfig } from "../../core/state/index.ts";

export async function authStatusCommand(): Promise<void> {
  const config = getAuthConfig();
  if (!config.githubToken) {
    p.log.warn("Not logged in. Run: smcp auth login");
    return;
  }
  const s = p.spinner();
  s.start("Checking token validity...");
  try {
    const client = new GitHubClient(config.githubToken);
    const user = await client.verifyUser();
    s.stop(pc.green(`✔ Logged in as @${user.login}`));

    if (user.scopes && user.scopes.length > 0) {
      const scopeList = user.scopes.join(", ");
      const repoSupported = user.hasRepoScope
        ? pc.green("✔ Repositories enabled")
        : pc.yellow("✖ Missing 'repo' scope");
      const gistSupported = user.hasGistScope
        ? pc.green("✔ Gists enabled")
        : pc.yellow("✖ Missing 'gist' scope");
      p.log.info(`Token scopes: ${pc.cyan(scopeList)} (${gistSupported}, ${repoSupported})`);

      if (!user.hasRepoScope) {
        p.log.message(
          pc.dim(
            "Tip: To share packs directly to GitHub Repositories, regenerate your token with 'repo' scope at:\n" +
              "https://github.com/settings/tokens/new?scopes=gist,repo&description=smcp-cli"
          )
        );
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    s.stop(pc.red("✖ Stored token is invalid or expired."));
    p.log.message(`Error: ${message}`);
  }
}
