import type { AuthUser } from "../../auth/types.ts";
import type {
  GitProvider,
  GitRepoRef,
  GitSnippetRef,
  RepoPackResult,
  SnippetPackResult,
  GitFetchOptions,
  GitCommitParams,
  GitCommitResult,
  GitPublishSnippetParams,
  GitSnippetResult
} from "./types.ts";
import { GitLabClient } from "./client.ts";
import { parseGitLabRepo, fetchGitLabRepoPack, commitGitLabFiles } from "./repo.ts";
import { parseGitLabSnippet, fetchGitLabSnippetPack, publishGitLabSnippet } from "./snippet.ts";

export class GitLabGitProvider implements GitProvider {
  readonly id = "gitlab";
  readonly name = "GitLab";
  readonly defaultHost = "gitlab.com";

  matchesRepo(source: string): boolean {
    if (!source || typeof source !== "string") return false;
    return parseGitLabRepo(source) !== null;
  }

  parseRepo(source: string): GitRepoRef | null {
    return parseGitLabRepo(source);
  }

  matchesSnippet(source: string): boolean {
    if (!source || typeof source !== "string") return false;
    return parseGitLabSnippet(source) !== null;
  }

  parseSnippet(source: string): GitSnippetRef | null {
    return parseGitLabSnippet(source);
  }

  async fetchRepoPack(ref: GitRepoRef, options?: GitFetchOptions): Promise<RepoPackResult> {
    return fetchGitLabRepoPack(ref, options?.token, options);
  }

  async fetchSnippetPack(ref: GitSnippetRef, options?: GitFetchOptions): Promise<SnippetPackResult> {
    return fetchGitLabSnippetPack(ref, options?.token, options);
  }

  async commitFilesToRepo(params: GitCommitParams): Promise<GitCommitResult> {
    return commitGitLabFiles({
      projectPath: `${params.owner}/${params.repo}`,
      branch: params.branch,
      message: params.message,
      files: params.files,
      isPublic: params.isPublic,
      description: params.description,
      token: params.token,
      host: params.host || this.defaultHost
    });
  }

  async publishSnippet(params: GitPublishSnippetParams): Promise<GitSnippetResult> {
    return publishGitLabSnippet(params);
  }

  async verifyUser(token: string, host?: string): Promise<AuthUser> {
    const client = new GitLabClient(
      token,
      host && host !== this.defaultHost ? { baseURL: `https://${host}/api/v4` } : undefined
    );
    const data = await client.verifyUser();
    return {
      username: data.username,
      scopes: undefined,
      metadata: {
        id: data.id,
        name: data.name,
        email: data.email
      }
    };
  }
}
