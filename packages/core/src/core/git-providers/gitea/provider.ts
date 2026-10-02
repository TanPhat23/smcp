import type { AuthUser } from "../../auth/types.ts";
import type {
  GitProvider,
  GitRepoRef,
  RepoPackResult,
  GitFetchOptions,
  GitCommitParams,
  GitCommitResult
} from "./types.ts";
import { GiteaClient } from "./client.ts";
import { parseGiteaRepo, fetchGiteaRepoPack, commitGiteaFiles } from "./repo.ts";

export class GiteaGitProvider implements GitProvider {
  readonly id = "gitea";
  readonly name = "Gitea / Forgejo";
  readonly defaultHost = "gitea.com";
  readonly customHosts: string[];

  constructor(options?: { customHosts?: string[] }) {
    this.customHosts = options?.customHosts || [];
  }

  matchesRepo(source: string): boolean {
    if (!source || typeof source !== "string") return false;
    return parseGiteaRepo(source, this.customHosts) !== null;
  }

  parseRepo(source: string): GitRepoRef | null {
    return parseGiteaRepo(source, this.customHosts);
  }

  async fetchRepoPack(ref: GitRepoRef, options?: GitFetchOptions): Promise<RepoPackResult> {
    return fetchGiteaRepoPack(ref, options?.token, options);
  }

  async commitFilesToRepo(params: GitCommitParams): Promise<GitCommitResult> {
    return commitGiteaFiles({
      owner: params.owner,
      repo: params.repo,
      branch: params.branch,
      message: params.message,
      files: params.files,
      isPublic: params.isPublic,
      description: params.description,
      token: params.token,
      host: params.host || this.defaultHost
    });
  }

  async verifyUser(token: string, host?: string): Promise<AuthUser> {
    const client = new GiteaClient(
      token,
      host && host !== this.defaultHost ? { baseURL: `https://${host}/api/v1` } : undefined
    );
    const data = await client.verifyUser();
    return {
      username: data.login || data.username || "",
      scopes: undefined,
      metadata: {
        id: data.id,
        name: data.full_name || data.name,
        email: data.email
      }
    };
  }
}
