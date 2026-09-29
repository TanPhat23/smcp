import { GitHubClient } from "../github.ts";
import type { AuthProvider, AuthUser } from "./types.ts";

export class GitHubAuthProvider implements AuthProvider {
  readonly id = "github";
  readonly name = "GitHub";
  readonly envVars = ["GITHUB_TOKEN", "GH_TOKEN"];

  async verify(token: string): Promise<AuthUser> {
    const client = new GitHubClient(token);
    const user = await client.verifyUser();
    return {
      username: user.login,
      scopes: user.scopes,
      metadata: {
        hasRepoScope: user.hasRepoScope,
        hasGistScope: user.hasGistScope,
        id: user.id
      }
    };
  }

  getInstructions(): string {
    return (
      "To share packs as Gists or Repositories, smcp requires a GitHub Personal Access Token (PAT).\n" +
      "Generate one here: https://github.com/settings/tokens/new?scopes=gist,repo&description=smcp-cli"
    );
  }
}
