import type { AxiosAdapter, AxiosInstance } from "axios";
import type { Manifest } from "../../../types/index.ts";
import type {
  GitRepoRef,
  GitSnippetRef,
  RepoPackResult,
  SnippetPackResult,
  GitFetchOptions,
  GitCommitParams,
  GitCommitResult,
  GitPublishSnippetParams,
  GitSnippetResult,
  GitProvider
} from "../types.ts";

export type {
  GitRepoRef,
  GitSnippetRef,
  RepoPackResult,
  SnippetPackResult,
  GitFetchOptions,
  GitCommitParams,
  GitCommitResult,
  GitPublishSnippetParams,
  GitSnippetResult,
  GitProvider
};

export interface GitHubGistFile {
  content: string;
  filename?: string;
}

export interface CreateGistPayload {
  description: string;
  public: boolean;
  files: Record<string, { content: string }>;
}

export interface GistResponseFile {
  filename?: string;
  type?: string;
  language?: string;
  raw_url?: string;
  size?: number;
  truncated?: boolean;
  content: string;
}

export interface GistResponse {
  id: string;
  html_url: string;
  description?: string;
  files: Record<string, GistResponseFile>;
  [key: string]: unknown;
}

export interface GitHubClientOptions {
  timeoutMs?: number;
  axiosInstance?: AxiosInstance;
  adapter?: AxiosAdapter;
  baseURL?: string;
  noCache?: boolean;
  fetchAllTruncated?: boolean;
  cacheTtlMs?: number;
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
}

export interface GitHubUserResponse {
  login: string;
  name: string;
  scopes?: string[];
  hasRepoScope?: boolean;
  hasGistScope?: boolean;
  [key: string]: unknown;
}
