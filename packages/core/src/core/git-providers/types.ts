import type { Manifest } from "../../types/index.ts";
import type { AuthUser } from "../auth/types.ts";

export interface GitRepoRef {
  provider: string;
  host: string;
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
}

export interface GitSnippetRef {
  provider: string;
  host: string;
  snippetId: string;
}

export interface RepoPackResult {
  manifest: Manifest;
  rawFiles: Record<string, string>;
  repoFullName: string;
  ref: string;
  htmlUrl: string;
}

export interface SnippetPackResult {
  manifest: Manifest;
  rawFiles: Record<string, string>;
  snippetId: string;
  htmlUrl?: string;
}

export interface GitFetchOptions {
  token?: string;
  timeoutMs?: number;
  noCache?: boolean;
  cacheTtlMs?: number;
  fetchAllTruncated?: boolean;
}

export interface GitCommitParams {
  owner: string;
  repo: string;
  branch?: string;
  message: string;
  files: Record<string, string>;
  isPublic?: boolean;
  description?: string;
  token?: string;
  host?: string;
}

export interface GitCommitResult {
  commitSha: string;
  html_url: string;
  branch: string;
}

export interface GitPublishSnippetParams {
  title?: string;
  description?: string;
  files: Record<string, string>;
  isPublic?: boolean;
  token?: string;
  host?: string;
}

export interface GitSnippetResult {
  snippetId: string;
  htmlUrl: string;
}

export interface GitProvider {
  readonly id: string;
  readonly name: string;
  readonly defaultHost: string;

  // Pattern detection & parsing
  matchesRepo(source: string): boolean;
  parseRepo(source: string): GitRepoRef | null;

  matchesSnippet?(source: string): boolean;
  parseSnippet?(source: string): GitSnippetRef | null;

  // Remote pack operations (Read)
  fetchRepoPack(ref: GitRepoRef, options?: GitFetchOptions): Promise<RepoPackResult>;
  fetchSnippetPack?(ref: GitSnippetRef, options?: GitFetchOptions): Promise<SnippetPackResult>;

  // Remote pack operations (Write / Publish)
  commitFilesToRepo?(params: GitCommitParams): Promise<GitCommitResult>;
  publishSnippet?(params: GitPublishSnippetParams): Promise<GitSnippetResult>;

  // Authentication & Verification
  verifyUser(token: string, host?: string): Promise<AuthUser>;
}
