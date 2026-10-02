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

export interface GitLabClientOptions {
  baseURL?: string;
  timeoutMs?: number;
  adapter?: AxiosAdapter;
  axiosInstance?: AxiosInstance;
}

export interface GitLabRepoRef extends GitRepoRef {
  provider: "gitlab";
}

export interface GitLabSnippetRef extends GitSnippetRef {
  provider: "gitlab";
}

export interface GitLabUserResponse {
  id: number;
  username: string;
  name: string;
  state?: string;
  avatar_url?: string;
  web_url?: string;
  email?: string;
  [key: string]: unknown;
}

export interface GitLabProjectResponse {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  web_url: string;
  default_branch: string;
  visibility?: string;
  [key: string]: unknown;
}

export interface GitLabTreeItem {
  id: string;
  name: string;
  type: "blob" | "tree";
  path: string;
  mode: string;
}

export interface GitLabSnippetFile {
  path: string;
  raw_url: string;
}

export interface GitLabSnippetResponse {
  id: number;
  title: string;
  description?: string;
  visibility?: string;
  web_url: string;
  file_name?: string;
  files?: GitLabSnippetFile[];
  raw_url?: string;
  content?: string;
  [key: string]: unknown;
}
