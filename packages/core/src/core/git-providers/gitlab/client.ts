import type { AxiosAdapter, AxiosInstance } from "axios";
import { isAxiosError } from "axios";
import { createHttpClient } from "../../http.ts";
import type { GitLabClientOptions, GitLabUserResponse } from "./types.ts";

export const DEFAULT_GITLAB_TIMEOUT_MS = 60000;

export function formatGitLabApiError(err: unknown, defaultMsg: string): string {
  if (err instanceof Error && !isAxiosError(err)) {
    return `${defaultMsg}: ${err.message}`;
  }

  if (isAxiosError(err) && err.response) {
    const status = err.response.status;
    let detail = "";
    const data = err.response.data;

    if (typeof data === "string") {
      detail = data.trim().slice(0, 200);
    } else if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      if (typeof obj.message === "string") {
        detail = obj.message;
      } else if (typeof obj.error === "string") {
        detail = obj.error;
      } else if (obj.message && typeof obj.message === "object") {
        detail = JSON.stringify(obj.message);
      } else if (typeof obj.error_description === "string") {
        detail = obj.error_description;
      }
    }

    const category =
      status === 401 || status === 403
        ? "Auth failed"
        : status >= 500 && status < 600
        ? "GitLab service unavailable"
        : "";

    const info = [category, detail || err.message].filter(Boolean).join(": ") || "Unknown error";
    return `${defaultMsg}: ${status} ${info}`;
  }

  return `${defaultMsg}: ${String(err)}`;
}

export function createGitLabAxios(
  token?: string,
  options?: GitLabClientOptions | number
): AxiosInstance {
  const clientOptions: GitLabClientOptions =
    typeof options === "number" ? { timeoutMs: options } : options || {};

  if (clientOptions.axiosInstance) {
    return clientOptions.axiosInstance;
  }

  const timeoutMs = clientOptions.timeoutMs ?? DEFAULT_GITLAB_TIMEOUT_MS;
  const adapter = clientOptions.adapter;
  const baseURL = clientOptions.baseURL || "https://gitlab.com/api/v4";

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "smcp-cli"
  };

  if (token) {
    if (token.startsWith("Bearer ")) {
      headers.Authorization = token;
    } else {
      headers["PRIVATE-TOKEN"] = token;
    }
  }

  const http = createHttpClient({
    baseURL,
    timeoutMs,
    adapter,
    headers
  });

  return http.raw;
}

export class GitLabClient {
  #token?: string;
  #client: AxiosInstance;

  constructor(token?: string, options?: GitLabClientOptions | number) {
    this.#token = token;
    const clientOptions: GitLabClientOptions =
      typeof options === "number" ? { timeoutMs: options } : options || {};
    this.#client = clientOptions.axiosInstance || createGitLabAxios(token, clientOptions);
  }

  get client(): AxiosInstance {
    return this.#client;
  }

  async verifyUser(): Promise<GitLabUserResponse> {
    try {
      const res = await this.#client.get<GitLabUserResponse>("/user");
      return res.data;
    } catch (err: unknown) {
      throw new Error(formatGitLabApiError(err, "GitLab Authentication failed"));
    }
  }
}
