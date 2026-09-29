import * as p from "@clack/prompts";
import pc from "picocolors";
import { GitHubClient } from "../../core/github.ts";
import { saveAuthConfig } from "../../core/state/index.ts";

export async function authLoginCommand(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" smcp — GitHub Authentication ")));

  p.note(
    "To share packs as Gists or Repositories, smcp requires a GitHub Personal Access Token (PAT).\n" +
      "Generate one here: https://github.com/settings/tokens/new?scopes=gist,repo&description=smcp-cli",
    "Instructions"
  );

  const token = await p.password({
    message: "Enter your GitHub Personal Access Token (PAT):",
    validate: (val) => (!val || !val.trim() ? "Token is required" : undefined)
  });

  if (p.isCancel(token) || typeof token !== "string") {
    p.cancel("Authentication cancelled.");
    return;
  }

  const trimmedToken = token.trim();
  const s = p.spinner();
  s.start("Verifying token with GitHub...");

  try {
    const client = new GitHubClient(trimmedToken);
    const user = await client.verifyUser();
    saveAuthConfig({ githubToken: trimmedToken, githubUser: user.login });
    s.stop(pc.green(`✔ Authenticated successfully as @${user.login}`));
    p.outro("Saved securely to ~/.smcp/config.json");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    s.stop(pc.red("✖ Authentication failed"));
    p.cancel(message);
  }
}
