import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GitHubClient } from "../src/core/github.ts";

describe("GitHubClient", () => {
  const originalFetch = globalThis.fetch;
  let lastRequest: { url: string; init?: RequestInit } | null = null;

  beforeEach(() => {
    lastRequest = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("verifyUser()", () => {
    it("sends correct headers and returns authenticated user object", async () => {
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        lastRequest = { url: input.toString(), init };
        return new Response(
          JSON.stringify({
            login: "octocat",
            name: "Mona Lisa Octocat",
            id: 1
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const client = new GitHubClient("ghp_testToken123");
      const user = await client.verifyUser();

      expect(lastRequest).toBeDefined();
      expect(lastRequest?.url).toBe("https://api.github.com/user");

      const headers = (lastRequest?.init?.headers || {}) as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer ghp_testToken123");
      expect(headers["Accept"]).toBe("application/vnd.github+json");
      expect(headers["User-Agent"]).toBe("smcp-cli");
      expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");

      expect(user.login).toBe("octocat");
      expect(user.name).toBe("Mona Lisa Octocat");
    });

    it("handles 401 Unauthorized with descriptive error", async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            message: "Bad credentials",
            documentation_url: "https://docs.github.com/rest"
          }),
          { status: 401, statusText: "Unauthorized" }
        );
      }) as typeof fetch;

      const client = new GitHubClient("ghp_invalidToken");
      await expect(client.verifyUser()).rejects.toThrow(/401|Unauthorized|Bad credentials/i);
    });

    it("handles unexpected server error with descriptive error", async () => {
      globalThis.fetch = (async () => {
        return new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" });
      }) as typeof fetch;

      const client = new GitHubClient("ghp_validToken");
      await expect(client.verifyUser()).rejects.toThrow(/500/);
    });
  });

  describe("createGist()", () => {
    it("sends correct payload and returns id and html_url", async () => {
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        lastRequest = { url: input.toString(), init };
        return new Response(
          JSON.stringify({
            id: "gist_998877",
            html_url: "https://gist.github.com/octocat/gist_998877"
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const client = new GitHubClient("ghp_testToken123");
      const payload = {
        description: "Shared MCP & Skills pack: my-bundle",
        public: true,
        files: {
          "smcp.json": { content: JSON.stringify({ name: "my-bundle", version: "1.0.0" }) },
          "README.md": { content: "# My Bundle" }
        }
      };

      const result = await client.createGist(payload);

      expect(lastRequest?.url).toBe("https://api.github.com/gists");
      expect(lastRequest?.init?.method).toBe("POST");

      const headers = (lastRequest?.init?.headers || {}) as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer ghp_testToken123");

      const sentBody = JSON.parse(lastRequest?.init?.body as string);
      expect(sentBody.description).toBe("Shared MCP & Skills pack: my-bundle");
      expect(sentBody.public).toBe(true);
      expect(sentBody.files["smcp.json"].content).toBeDefined();

      expect(result.id).toBe("gist_998877");
      expect(result.html_url).toBe("https://gist.github.com/octocat/gist_998877");
    });

    it("handles API error when creating gist", async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            message: "Validation Failed",
            errors: [{ resource: "Gist", field: "files", code: "missing" }]
          }),
          { status: 422, statusText: "Unprocessable Entity" }
        );
      }) as typeof fetch;

      const client = new GitHubClient("ghp_testToken123");
      await expect(
        client.createGist({
          description: "invalid gist",
          public: false,
          files: {}
        })
      ).rejects.toThrow(/422/);
    });
  });

  describe("updateGist()", () => {
    it("sends PATCH request with payload and returns updated gist id and html_url", async () => {
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        lastRequest = { url: input.toString(), init };
        return new Response(
          JSON.stringify({
            id: "gist_existing123",
            html_url: "https://gist.github.com/octocat/gist_existing123"
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const client = new GitHubClient("ghp_testToken123");
      const updatePayload = {
        description: "Updated description",
        files: {
          "smcp.json": { content: JSON.stringify({ name: "my-bundle", version: "1.1.0" }) }
        }
      };

      const result = await client.updateGist("gist_existing123", updatePayload);

      expect(lastRequest?.url).toBe("https://api.github.com/gists/gist_existing123");
      expect(lastRequest?.init?.method).toBe("PATCH");

      const headers = (lastRequest?.init?.headers || {}) as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer ghp_testToken123");

      const sentBody = JSON.parse(lastRequest?.init?.body as string);
      expect(sentBody.description).toBe("Updated description");

      expect(result.id).toBe("gist_existing123");
      expect(result.html_url).toBe("https://gist.github.com/octocat/gist_existing123");
    });

    it("handles 404 Not Found when updating nonexistent gist", async () => {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          statusText: "Not Found"
        });
      }) as typeof fetch;

      const client = new GitHubClient("ghp_testToken123");
      await expect(
        client.updateGist("nonexistent_id", { description: "Update" })
      ).rejects.toThrow(/404/);
    });
  });

  describe("fetchGist() (static)", () => {
    const mockGistResponse = {
      id: "abc12345",
      html_url: "https://gist.github.com/octocat/abc12345",
      files: {
        "smcp.json": {
          filename: "smcp.json",
          content: '{"name":"pack","version":"1.0.0"}'
        },
        "SKILL.md": {
          filename: "SKILL.md",
          content: "# Skill content"
        }
      }
    };

    it("extracts Gist ID from full URL (https://gist.github.com/user/123456)", async () => {
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        lastRequest = { url: input.toString(), init };
        return new Response(JSON.stringify(mockGistResponse), { status: 200 });
      }) as typeof fetch;

      const result = await GitHubClient.fetchGist("https://gist.github.com/octocat/abc12345");

      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
      expect(result.files["smcp.json"].content).toBe('{"name":"pack","version":"1.0.0"}');
      expect(result.files["SKILL.md"].content).toBe("# Skill content");
    });

    it("extracts Gist ID from URL with trailing slash", async () => {
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        lastRequest = { url: input.toString(), init };
        return new Response(JSON.stringify(mockGistResponse), { status: 200 });
      }) as typeof fetch;

      await GitHubClient.fetchGist("https://gist.github.com/octocat/abc12345/");
      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
    });

    it("extracts Gist ID from raw ID string", async () => {
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        lastRequest = { url: input.toString(), init };
        return new Response(JSON.stringify(mockGistResponse), { status: 200 });
      }) as typeof fetch;

      await GitHubClient.fetchGist("abc12345");
      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
    });

    it("extracts Gist ID from URL without username (https://gist.github.com/123456)", async () => {
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        lastRequest = { url: input.toString(), init };
        return new Response(JSON.stringify(mockGistResponse), { status: 200 });
      }) as typeof fetch;

      await GitHubClient.fetchGist("https://gist.github.com/abc12345");
      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
    });

    it("omits Authorization header when token is not provided", async () => {
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        lastRequest = { url: input.toString(), init };
        return new Response(JSON.stringify(mockGistResponse), { status: 200 });
      }) as typeof fetch;

      await GitHubClient.fetchGist("abc12345");

      const headers = (lastRequest?.init?.headers || {}) as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
      expect(headers["User-Agent"]).toBe("smcp-cli");
    });

    it("sends Authorization header when token is provided", async () => {
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        lastRequest = { url: input.toString(), init };
        return new Response(JSON.stringify(mockGistResponse), { status: 200 });
      }) as typeof fetch;

      await GitHubClient.fetchGist("abc12345", "ghp_authToken999");

      const headers = (lastRequest?.init?.headers || {}) as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer ghp_authToken999");
    });

    it("handles 404 Not Found error when gist does not exist", async () => {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          statusText: "Not Found"
        });
      }) as typeof fetch;

      await expect(GitHubClient.fetchGist("missing_gist")).rejects.toThrow(/404/);
    });

    it("throws an error if gist ID cannot be parsed or is empty", async () => {
      await expect(GitHubClient.fetchGist("")).rejects.toThrow(/invalid gist id/i);
      await expect(GitHubClient.fetchGist("   ")).rejects.toThrow(/invalid gist id/i);
    });
  });
});
