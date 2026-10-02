import type { AxiosAdapter, AxiosInstance } from "axios";
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  HttpClient,
  createHttpClient,
  setDefaultHttpAdapter,
  clearHttpClientCache,
  getOrCreateAxiosInstance
} from "../../http.ts";
import {
  clearGistCache,
  clearGistDiskCache,
  getGistCacheDir,
  readGistCache,
  writeGistCache,
  touchGistCache,
  DEFAULT_GIST_CACHE_TTL_MS,
  type CacheEntry,
  type CacheOptions,
  type GistCacheEntry
} from "../../cache/index.ts";
import { formatApiError } from "./errors.ts";
import type {
  CreateGistPayload,
  GistResponse,
  GitHubClientOptions,
  GitHubRepoRef,
  GitHubUserResponse,
  RepoPackResult
} from "./types.ts";
import {
  fetchGist,
  createGist as gistCreateGist,
  updateGist as gistUpdateGist
} from "./gist.ts";
import {
  parseGitHubRepo,
  isRepoSource,
  fetchRepoFileContent,
  fetchRepoPack,
  getRepository,
  createRepository,
  commitFilesToRepo
} from "./repo.ts";

export {
  HttpClient,
  createHttpClient,
  clearHttpClientCache,
  getOrCreateAxiosInstance,
  clearGistCache,
  clearGistDiskCache,
  getGistCacheDir,
  readGistCache,
  writeGistCache,
  touchGistCache,
  DEFAULT_GIST_CACHE_TTL_MS,
  type CacheEntry,
  type CacheOptions,
  type GistCacheEntry
};

export const DEFAULT_TIMEOUT_MS = 60000;

export function clearGitHubClientCache(): void {
  clearHttpClientCache();
  clearGistCache();
}

export function setDefaultAxiosAdapter(adapter: AxiosAdapter | undefined): void {
  setDefaultHttpAdapter(adapter);
  clearGitHubClientCache();
}

export function createGitHubAxios(
  token?: string,
  options?: GitHubClientOptions | number
): AxiosInstance {
  const clientOptions: GitHubClientOptions =
    typeof options === "number" ? { timeoutMs: options } : options || {};

  if (clientOptions.axiosInstance) {
    return clientOptions.axiosInstance;
  }

  const timeoutMs = clientOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const adapter = clientOptions.adapter;
  const baseURL = clientOptions.baseURL || "https://api.github.com";

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "smcp-cli",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const http = createHttpClient({
    baseURL,
    timeoutMs,
    adapter,
    headers
  });

  return http.raw;
}

export class GitHubClient {
  #token?: string;
  #client: AxiosInstance;

  static parseRepo(input: string): GitHubRepoRef | null {
    return parseGitHubRepo(input);
  }

  static isRepoSource(input: string): boolean {
    return isRepoSource(input);
  }

  static async fetchRepoFileContent(
    client: AxiosInstance,
    owner: string,
    repo: string,
    ref: string,
    filePath: string,
    blobSha?: string
  ): Promise<string> {
    return fetchRepoFileContent(client, owner, repo, ref, filePath, blobSha);
  }

  static async fetchRepoPack(
    source: string,
    token?: string,
    options?: GitHubClientOptions | number
  ): Promise<RepoPackResult> {
    return fetchRepoPack(source, token, options);
  }

  static async fetchGist(
    gistIdOrUrl: string,
    token?: string,
    options?: GitHubClientOptions | number
  ): Promise<GistResponse> {
    return fetchGist(gistIdOrUrl, token, options);
  }

  constructor(token?: string, options?: GitHubClientOptions | number) {
    this.#token = token;
    const clientOptions: GitHubClientOptions =
      typeof options === "number" ? { timeoutMs: options } : options || {};
    this.#client = clientOptions.axiosInstance || createGitHubAxios(token, clientOptions);
  }

  get client(): AxiosInstance {
    return this.#client;
  }

  async verifyUser(): Promise<GitHubUserResponse> {
    try {
      const res = await this.#client.get<{ login: string; name: string }>("/user");
      const scopesHeader = res.headers?.["x-oauth-scopes"];
      let scopes: string[] | undefined = undefined;
      let hasRepoScope: boolean | undefined = undefined;
      let hasGistScope: boolean | undefined = undefined;

      if (typeof scopesHeader === "string") {
        scopes = scopesHeader
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        hasRepoScope = scopes.includes("repo") || scopes.includes("public_repo");
        hasGistScope = scopes.includes("gist");
      }

      return {
        ...res.data,
        scopes,
        hasRepoScope,
        hasGistScope
      };
    } catch (err: unknown) {
      throw new Error(await formatApiError(err, "GitHub Authentication failed"));
    }
  }

  async createGist(
    payload: CreateGistPayload
  ): Promise<{ id: string; html_url: string; [key: string]: unknown }> {
    return gistCreateGist(payload, this.#client);
  }

  async updateGist(
    gistId: string,
    payload: Partial<CreateGistPayload>
  ): Promise<{ id: string; html_url: string; [key: string]: unknown }> {
    return gistUpdateGist(gistId, payload, this.#client);
  }

  async getRepository(
    owner: string,
    repo: string
  ): Promise<{ id: number; name: string; full_name: string; html_url: string; default_branch: string } | null> {
    return getRepository(owner, repo, this.#client);
  }

  async createRepository(payload: {
    name: string;
    description?: string;
    private?: boolean;
    org?: string;
    auto_init?: boolean;
  }): Promise<{ id: number; name: string; full_name: string; html_url: string; default_branch: string }> {
    return createRepository(payload, this.#client);
  }

  async commitFilesToRepo(params: {
    owner: string;
    repo: string;
    branch?: string;
    message: string;
    files: Record<string, string>;
    isPublic?: boolean;
    description?: string;
  }): Promise<{ commitSha: string; html_url: string; branch: string }> {
    return commitFilesToRepo({
      ...params,
      token: this.#token,
      client: this.#client
    });
  }
}
