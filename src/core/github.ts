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

export class GitHubClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "smcp-cli",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  async verifyUser(): Promise<{ login: string; name: string; [key: string]: unknown }> {
    const res = await fetch("https://api.github.com/user", {
      headers: this.headers()
    });
    if (!res.ok) {
      let errorDetail = res.statusText;
      try {
        const body = (await res.json()) as { message?: string };
        if (body && typeof body === "object" && body.message) {
          errorDetail = body.message;
        }
      } catch {
        // Fall back to statusText if body is not JSON
      }
      throw new Error(`GitHub Authentication failed: ${res.status} ${errorDetail || "Unauthorized"}`);
    }
    return (await res.json()) as { login: string; name: string };
  }

  async createGist(payload: CreateGistPayload): Promise<{ id: string; html_url: string; [key: string]: unknown }> {
    const res = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create Gist: ${res.status} ${err || res.statusText}`);
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
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to update Gist ${gistId}: ${res.status} ${err || res.statusText}`);
    }
    return (await res.json()) as { id: string; html_url: string };
  }

  static async fetchGist(gistIdOrUrl: string, token?: string): Promise<GistResponse> {
    if (!gistIdOrUrl || typeof gistIdOrUrl !== "string" || gistIdOrUrl.trim().length === 0) {
      throw new Error("Invalid Gist ID or URL provided");
    }

    const trimmed = gistIdOrUrl.trim().replace(/\/+$/, "");
    const segments = trimmed.split("/");
    const id = segments[segments.length - 1];

    if (!id || id.trim().length === 0) {
      throw new Error("Invalid Gist ID or URL provided");
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "smcp-cli",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(id)}`, { headers });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch Gist ${id}: ${res.status} ${err || res.statusText}`);
    }

    return (await res.json()) as GistResponse;
  }
}
