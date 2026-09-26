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

export const DEFAULT_TIMEOUT_MS = 15000;

export async function formatApiError(res: Response, defaultMsg: string): Promise<string> {
  const status = res.status;
  let statusCategory = "";
  if (status === 401 || status === 403) {
    statusCategory = "Auth failed";
  } else if (status >= 500 && status < 600) {
    statusCategory = "GitHub service unavailable";
  }

  let detail = "";
  try {
    const rawText = await res.text();
    if (rawText && rawText.trim().length > 0) {
      try {
        const body = JSON.parse(rawText);
        if (body && typeof body === "object") {
          const parts: string[] = [];
          if (body.message && typeof body.message === "string") {
            parts.push(body.message.trim());
          }
          if (body.errors) {
            if (Array.isArray(body.errors)) {
              const errs = body.errors.map((e: unknown) => {
                if (typeof e === "string") return e;
                if (typeof e === "object" && e !== null) {
                  const item = e as Record<string, unknown>;
                  if (item.message && typeof item.message === "string") return item.message;
                  if (item.field && item.code) return `${item.field} (${item.code})`;
                  return JSON.stringify(e);
                }
                return String(e);
              });
              parts.push(errs.join(", "));
            } else if (typeof body.errors === "string") {
              parts.push(body.errors);
            } else {
              parts.push(JSON.stringify(body.errors));
            }
          }
          detail = parts.filter(Boolean).join(" - ");
        } else if (typeof body === "string") {
          detail = body.trim();
        }
      } catch {
        // Not JSON: truncate non-JSON strings (e.g. HTML or large error responses)
        const trimmed = rawText.trim();
        detail = trimmed.length > 200 ? trimmed.slice(0, 200) + "..." : trimmed;
      }
    }
  } catch {
    // Response body could not be read
  }

  const statusText = res.statusText ? res.statusText.trim() : "";
  const descriptors: string[] = [];
  if (statusCategory) {
    descriptors.push(statusCategory);
  }
  if (detail) {
    descriptors.push(detail);
  } else if (statusText) {
    descriptors.push(statusText);
  }

  const finalDetail = descriptors.length > 0 ? descriptors.join(": ") : "Unknown error";
  return `${defaultMsg}: ${status} ${finalDetail}`;
}

export function parseGistId(gistIdOrUrl: string): string {
  if (!gistIdOrUrl || typeof gistIdOrUrl !== "string" || gistIdOrUrl.trim().length === 0) {
    throw new Error("Invalid Gist ID or URL provided");
  }

  const trimmed = gistIdOrUrl.trim();
  let id = "";

  if (trimmed.includes("://")) {
    try {
      const url = new URL(trimmed);
      let pathname = url.pathname.replace(/\/+$/, "");
      if (pathname.endsWith(".git")) {
        pathname = pathname.slice(0, -4).replace(/\/+$/, "");
      }
      const segments = pathname.split("/").filter(Boolean);
      id = segments[segments.length - 1] || "";
    } catch {
      throw new Error("Invalid Gist ID or URL provided");
    }
  } else {
    let clean = trimmed.split("#")[0].split("?")[0].replace(/\/+$/, "");
    if (clean.endsWith(".git")) {
      clean = clean.slice(0, -4).replace(/\/+$/, "");
    }
    const segments = clean.split("/").filter(Boolean);
    id = segments[segments.length - 1] || "";
  }

  if (!id || !/^[a-fA-F0-9]+$/.test(id)) {
    throw new Error("Invalid Gist ID or URL provided");
  }

  return id;
}

export class GitHubClient {
  #token: string;
  #timeoutMs: number;

  constructor(token: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.#token = token;
    this.#timeoutMs = timeoutMs;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.#token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "smcp-cli",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  async verifyUser(): Promise<{ login: string; name: string; [key: string]: unknown }> {
    const res = await fetch("https://api.github.com/user", {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.#timeoutMs)
    });
    if (!res.ok) {
      throw new Error(await formatApiError(res, "GitHub Authentication failed"));
    }
    return (await res.json()) as { login: string; name: string };
  }

  async createGist(payload: CreateGistPayload): Promise<{ id: string; html_url: string; [key: string]: unknown }> {
    const res = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.#timeoutMs)
    });
    if (!res.ok) {
      throw new Error(await formatApiError(res, "Failed to create Gist"));
    }
    return (await res.json()) as { id: string; html_url: string };
  }

  async updateGist(
    gistId: string,
    payload: Partial<CreateGistPayload>
  ): Promise<{ id: string; html_url: string; [key: string]: unknown }> {
    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.#timeoutMs)
    });
    if (!res.ok) {
      throw new Error(await formatApiError(res, `Failed to update Gist ${gistId}`));
    }
    return (await res.json()) as { id: string; html_url: string };
  }

  static async fetchGist(
    gistIdOrUrl: string,
    token?: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<GistResponse> {
    const id = parseGistId(gistIdOrUrl);

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "smcp-cli",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(id)}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      throw new Error(await formatApiError(res, `Failed to fetch Gist ${id}`));
    }

    return (await res.json()) as GistResponse;
  }
}
