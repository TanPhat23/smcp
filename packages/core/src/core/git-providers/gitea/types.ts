import type { AxiosAdapter, AxiosInstance } from "axios";
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
} from "../types.ts";

export type {
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
};

export interface GiteaClientOptions {
  baseURL?: string;
  timeoutMs?: number;
  adapter?: AxiosAdapter;
  axiosInstance?: AxiosInstance;
}

export interface GiteaRepoRef extends GitRepoRef {
  provider: "gitea";
}

export interface GiteaUserResponse {
  id: number;
  login: string;
  username?: string;
  full_name?: string;
  email?: string;
  avatar_url?: string;
  [key: string]: unknown;
}

export interface GiteaRepoResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url?: string;
  default_branch: string;
  private?: boolean;
  [key: string]: unknown;
}

export interface GiteaTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  size?: number;
  sha: string;
  url?: string;
}

export interface GiteaTreeResponse {
  sha: string;
  url?: string;
  tree: GiteaTreeEntry[];
  truncated?: boolean;
}
