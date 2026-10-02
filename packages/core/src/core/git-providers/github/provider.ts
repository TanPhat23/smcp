import fs from "node:fs";
import { ManifestSchema } from "../../../types/index.ts";
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
import { GitHubClient } from "./client.ts";
import { parseGistId, fetchGist, createGist as gistCreateGist } from "./gist.ts";
import { parseGitHubRepo, isRepoSource, fetchRepoPack, commitFilesToRepo } from "./repo.ts";

export class GitHubGitProvider implements GitProvider {
  readonly id = "github";
  readonly name = "GitHub";
  readonly defaultHost = "github.com";

  matchesRepo(source: string): boolean {
    return isRepoSource(source);
  }

  parseRepo(source: string): GitRepoRef | null {
    const parsed = parseGitHubRepo(source);
    if (!parsed) return null;
    return {
      provider: this.id,
      host: this.defaultHost,
      owner: parsed.owner,
      repo: parsed.repo,
      ref: parsed.ref,
      subpath: parsed.subpath
    };
  }

  matchesSnippet(source: string): boolean {
    if (!source || typeof source !== "string") return false;
    const trimmed = source.trim();
    if (trimmed.startsWith("gist:")) return true;
    if (trimmed.includes("://")) {
      try {
        const u = new URL(trimmed);
        return u.hostname === "gist.github.com";
      } catch {
        return false;
      }
    }
    if (!fs.existsSync(trimmed) && /^[a-fA-F0-9]{20,40}$/.test(trimmed)) {
      return true;
    }
    return false;
  }

  parseSnippet(source: string): GitSnippetRef | null {
    if (!this.matchesSnippet(source)) return null;
    try {
      let target = source.trim();
      if (target.startsWith("gist:")) {
        target = target.slice(5);
      }
      const id = parseGistId(target);
      return {
        provider: this.id,
        host: this.defaultHost,
        snippetId: id
      };
    } catch {
      return null;
    }
  }

  async fetchRepoPack(ref: GitRepoRef, options?: GitFetchOptions): Promise<RepoPackResult> {
    return GitHubClient.fetchRepoPack(ref, options?.token, options);
  }

  async fetchSnippetPack(ref: GitSnippetRef, options?: GitFetchOptions): Promise<SnippetPackResult> {
    const gist = await GitHubClient.fetchGist(ref.snippetId, options?.token, options);
    if (!gist.files || !gist.files["smcp.json"]) {
      throw new Error("Gist does not contain an smcp.json manifest file.");
    }
    const manifest = ManifestSchema.parse(JSON.parse(gist.files["smcp.json"].content));
    const rawFiles: Record<string, string> = {};
    for (const [filename, fileObj] of Object.entries(gist.files)) {
      rawFiles[filename] = fileObj.content;
    }
    return {
      manifest,
      rawFiles,
      snippetId: gist.id,
      htmlUrl: gist.html_url
    };
  }

  async commitFilesToRepo(params: GitCommitParams): Promise<GitCommitResult> {
    return commitFilesToRepo({
      owner: params.owner,
      repo: params.repo,
      branch: params.branch,
      message: params.message,
      files: params.files,
      isPublic: params.isPublic,
      description: params.description,
      token: params.token,
      host: params.host
    });
  }

  async publishSnippet(params: GitPublishSnippetParams): Promise<GitSnippetResult> {
    const gistFiles: Record<string, { content: string }> = {};
    for (const [filename, content] of Object.entries(params.files)) {
      gistFiles[filename] = { content };
    }
    const description = params.description || params.title || "";
    const isPublic = Boolean(params.isPublic);

    const gist = await gistCreateGist(
      {
        description,
        public: isPublic,
        files: gistFiles
      },
      params.token,
      params.host && params.host !== this.defaultHost
        ? { baseURL: `https://${params.host}/api/v3` }
        : undefined
    );

    return {
      snippetId: gist.id,
      htmlUrl: gist.html_url
    };
  }

  async verifyUser(token: string, host?: string): Promise<AuthUser> {
    const client = new GitHubClient(
      token,
      host && host !== this.defaultHost ? { baseURL: `https://${host}/api/v3` } : undefined
    );
    const data = await client.verifyUser();
    return {
      username: data.login,
      scopes: data.scopes,
      metadata: {
        hasRepoScope: data.hasRepoScope,
        hasGistScope: data.hasGistScope,
        id: data.id,
        name: data.name
      }
    };
  }
}
