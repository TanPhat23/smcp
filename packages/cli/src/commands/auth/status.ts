import * as p from "@clack/prompts";
import pc from "picocolors";
import { getAuthProvider, getAuthToken } from "@smcp/core";

export async function authStatusCommand(provider = "github"): Promise<void> {
  const authProvider = getAuthProvider(provider);
  if (!authProvider) {
    p.log.error(`Unsupported auth provider: '${provider}'.`);
    return;
  }

  const isGitHub = authProvider.id === "github";
  const token = getAuthToken(provider);

  if (!token) {
    if (isGitHub) {
      p.log.warn("Not logged in. Run: smcp auth login");
    } else {
      p.log.warn(`Not logged in. Run: smcp auth login ${authProvider.id}`);
    }
    return;
  }

  const s = p.spinner();
  s.start("Checking token validity...");
  try {
    const user = await authProvider.verify(token);
    s.stop(pc.green(`✔ Logged in as @${user.username}`));

    if (isGitHub) {
      const hasRepoScope = Boolean(user.metadata?.hasRepoScope);
      const hasGistScope = Boolean(user.metadata?.hasGistScope);
      if (user.scopes && user.scopes.length > 0) {
        const scopeList = user.scopes.join(", ");
        const repoSupported = hasRepoScope
          ? pc.green("✔ Repositories enabled")
          : pc.yellow("✖ Missing 'repo' scope");
        const gistSupported = hasGistScope
          ? pc.green("✔ Gists enabled")
          : pc.yellow("✖ Missing 'gist' scope");
        p.log.info(`Token scopes: ${pc.cyan(scopeList)} (${gistSupported}, ${repoSupported})`);

        if (!hasRepoScope) {
          p.log.message(
            pc.dim(
              "Tip: To share packs directly to GitHub Repositories, regenerate your token with 'repo' scope at:\n" +
                "https://github.com/settings/tokens/new?scopes=gist,repo&description=smcp-cli"
            )
          );
        }
      }
    } else if (user.scopes && user.scopes.length > 0) {
      p.log.info(`Token scopes: ${pc.cyan(user.scopes.join(", "))}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    s.stop(pc.red("✖ Stored token is invalid or expired."));
    p.log.message(`Error: ${message}`);
  }
}
