import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import {
  clearGitHubClientCache,
  createGitHubAxios,
  formatApiError,
  generatePackReadme,
  GitHubClient,
  isRepoSource,
  parseGistId,
  parseGitHubRepo,
  setDefaultAxiosAdapter
} from "../src/core/github.ts";

describe("GitHubClient", () => {
  interface CapturedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    data?: unknown;
  }

  let lastRequest: CapturedRequest | null = null;
  let mockHandler:
    | ((config: InternalAxiosRequestConfig) => {
        status?: number;
        statusText?: string;
        data: unknown;
        headers?: Record<string, string>;
      })
    | null = null;

  beforeEach(() => {
    lastRequest = null;
    mockHandler = null;
    setDefaultAxiosAdapter(async (config) => {
      const fullUrl =
        config.baseURL && !config.url?.startsWith("http")
          ? `${config.baseURL.replace(/\/+$/, "")}/${config.url?.replace(/^\/+/, "")}`
          : config.url || "";

      let parsedData: unknown = config.data;
      if (typeof config.data === "string") {
        try {
          parsedData = JSON.parse(config.data);
        } catch {
          parsedData = config.data;
        }
      }

      const headersMap: Record<string, string> = {};
      if (config.headers) {
        for (const [k, v] of Object.entries(config.headers)) {
          if (typeof v === "string") {
            headersMap[k] = v;
          }
        }
      }

      lastRequest = {
        url: fullUrl,
        method: (config.method || "get").toUpperCase(),
        headers: headersMap,
        data: parsedData
      };

      if (!mockHandler) {
        throw new Error("No mock handler defined in test");
      }

      const res = mockHandler(config);
      const status = res.status ?? 200;
      const statusText = res.statusText ?? (status < 400 ? "OK" : "Error");
      const response = {
        data: res.data,
        status,
        statusText,
        headers: res.headers || {},
        config
      };

      if (status >= 400) {
        throw new AxiosError(
          `Request failed with status code ${status}`,
          status === 401 ? "ERR_BAD_REQUEST" : undefined,
          config,
          null,
          response as any
        );
      }

      return response as any;
    });
  });

  afterEach(() => {
    setDefaultAxiosAdapter(undefined);
  });

  describe("Token privacy (#token)", () => {
    it("does not expose #token in Object.keys() or JSON.stringify()", () => {
      const secret = "ghp_superSecretToken123456789";
      const client = new GitHubClient(secret);

      const keys = Object.keys(client);
      expect(keys).not.toContain("token");
      expect(keys).not.toContain("#token");
      expect(keys).not.toContain("client");

      const json = JSON.stringify(client);
      expect(json).not.toContain(secret);
      expect(json).not.toContain("token");
    });
  });

  describe("verifyUser()", () => {
    it("sends correct headers and returns authenticated user object", async () => {
      mockHandler = () => ({
        status: 200,
        data: {
          login: "octocat",
          name: "Mona Lisa Octocat",
          id: 1
        }
      });

      const client = new GitHubClient("ghp_testToken123");
      const user = await client.verifyUser();

      expect(lastRequest).toBeDefined();
      expect(lastRequest?.url).toBe("https://api.github.com/user");
      expect(lastRequest?.method).toBe("GET");

      const headers = lastRequest?.headers || {};
      expect(headers["Authorization"]).toBe("Bearer ghp_testToken123");
      expect(headers["Accept"]).toBe("application/vnd.github+json");
      expect(headers["User-Agent"]).toBe("smcp-cli");
      expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");

      expect(user.login).toBe("octocat");
      expect(user.name).toBe("Mona Lisa Octocat");
    });

    it("parses x-oauth-scopes header with gist and repo scopes", async () => {
      mockHandler = () => ({
        status: 200,
        headers: {
          "x-oauth-scopes": "gist, repo, workflow"
        },
        data: {
          login: "octocat",
          name: "Mona Lisa Octocat",
          id: 1
        }
      });

      const client = new GitHubClient("ghp_testToken123");
      const user = await client.verifyUser();

      expect(user.scopes).toEqual(["gist", "repo", "workflow"]);
      expect(user.hasRepoScope).toBe(true);
      expect(user.hasGistScope).toBe(true);
    });

    it("detects missing repo scope when only gist is present", async () => {
      mockHandler = () => ({
        status: 200,
        headers: {
          "x-oauth-scopes": "gist, read:user"
        },
        data: {
          login: "octocat",
          name: "Mona Lisa Octocat",
          id: 1
        }
      });

      const client = new GitHubClient("ghp_testToken123");
      const user = await client.verifyUser();

      expect(user.scopes).toEqual(["gist", "read:user"]);
      expect(user.hasRepoScope).toBe(false);
      expect(user.hasGistScope).toBe(true);
    });

    it("recognizes public_repo as granting repo scope", async () => {
      mockHandler = () => ({
        status: 200,
        headers: {
          "x-oauth-scopes": "public_repo"
        },
        data: {
          login: "octocat",
          name: "Mona Lisa Octocat",
          id: 1
        }
      });

      const client = new GitHubClient("ghp_testToken123");
      const user = await client.verifyUser();

      expect(user.hasRepoScope).toBe(true);
      expect(user.hasGistScope).toBe(false);
    });

    it("handles fine-grained tokens or missing x-oauth-scopes header gracefully", async () => {
      mockHandler = () => ({
        status: 200,
        headers: {},
        data: {
          login: "octocat",
          name: "Mona Lisa Octocat",
          id: 1
        }
      });

      const client = new GitHubClient("ghp_testToken123");
      const user = await client.verifyUser();

      expect(user.scopes).toBeUndefined();
      expect(user.hasRepoScope).toBeUndefined();
      expect(user.hasGistScope).toBeUndefined();
    });

    it("handles 401 Unauthorized with descriptive error", async () => {
      mockHandler = () => ({
        status: 401,
        statusText: "Unauthorized",
        data: {
          message: "Bad credentials",
          documentation_url: "https://docs.github.com/rest"
        }
      });

      const client = new GitHubClient("ghp_invalidToken");
      await expect(client.verifyUser()).rejects.toThrow(/401|Unauthorized|Bad credentials/i);
    });

    it("handles unexpected server error with descriptive error", async () => {
      mockHandler = () => ({
        status: 500,
        statusText: "Internal Server Error",
        data: "Internal Server Error"
      });

      const client = new GitHubClient("ghp_validToken");
      await expect(client.verifyUser()).rejects.toThrow(/500/);
    });
  });

  describe("createGist()", () => {
    it("sends correct payload and returns id and html_url", async () => {
      mockHandler = () => ({
        status: 201,
        data: {
          id: "gist_998877",
          html_url: "https://gist.github.com/octocat/gist_998877"
        }
      });

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
      expect(lastRequest?.method).toBe("POST");

      const headers = lastRequest?.headers || {};
      expect(headers["Authorization"]).toBe("Bearer ghp_testToken123");

      const sentBody = lastRequest?.data as any;
      expect(sentBody.description).toBe("Shared MCP & Skills pack: my-bundle");
      expect(sentBody.public).toBe(true);
      expect(sentBody.files["smcp.json"].content).toBeDefined();

      expect(result.id).toBe("gist_998877");
      expect(result.html_url).toBe("https://gist.github.com/octocat/gist_998877");
    });

    it("handles API error when creating gist", async () => {
      mockHandler = () => ({
        status: 422,
        statusText: "Unprocessable Entity",
        data: {
          message: "Validation Failed",
          errors: [{ resource: "Gist", field: "files", code: "missing" }]
        }
      });

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
      mockHandler = () => ({
        status: 200,
        data: {
          id: "gist_existing123",
          html_url: "https://gist.github.com/octocat/gist_existing123"
        }
      });

      const client = new GitHubClient("ghp_testToken123");
      const updatePayload = {
        description: "Updated description",
        files: {
          "smcp.json": { content: JSON.stringify({ name: "my-bundle", version: "1.1.0" }) }
        }
      };

      const result = await client.updateGist("gist_existing123", updatePayload);

      expect(lastRequest?.url).toBe("https://api.github.com/gists/gist_existing123");
      expect(lastRequest?.method).toBe("PATCH");

      const headers = lastRequest?.headers || {};
      expect(headers["Authorization"]).toBe("Bearer ghp_testToken123");

      const sentBody = lastRequest?.data as any;
      expect(sentBody.description).toBe("Updated description");

      expect(result.id).toBe("gist_existing123");
      expect(result.html_url).toBe("https://gist.github.com/octocat/gist_existing123");
    });

    it("handles 404 Not Found when updating nonexistent gist", async () => {
      mockHandler = () => ({
        status: 404,
        statusText: "Not Found",
        data: { message: "Not Found" }
      });

      const client = new GitHubClient("ghp_testToken123");
      await expect(
        client.updateGist("nonexistent_id", { description: "Update" })
      ).rejects.toThrow(/404/);
    });
  });

  describe("formatApiError", () => {
    it("formats JSON error response with message and errors array", async () => {
      const jsonRes = new Response(
        JSON.stringify({
          message: "Validation Failed",
          errors: [{ resource: "Gist", field: "files", code: "missing" }]
        }),
        { status: 422, statusText: "Unprocessable Entity" }
      );

      const formatted = await formatApiError(jsonRes, "Failed to create Gist");
      expect(formatted).toContain("Failed to create Gist");
      expect(formatted).toContain("422");
      expect(formatted).toContain("Validation Failed");
      expect(formatted).toContain("files (missing)");
    });

    it("formats 401 Auth failed error cleanly", async () => {
      const authRes = new Response(
        JSON.stringify({ message: "Bad credentials" }),
        { status: 401, statusText: "Unauthorized" }
      );

      const formatted = await formatApiError(authRes, "GitHub Authentication failed");
      expect(formatted).toContain("401");
      expect(formatted).toContain("Auth failed");
      expect(formatted).toContain("Bad credentials");
    });

    it("formats 403 Auth failed error cleanly", async () => {
      const forbiddenRes = new Response(
        JSON.stringify({ message: "Resource not accessible by personal access token" }),
        { status: 403, statusText: "Forbidden" }
      );

      const formatted = await formatApiError(forbiddenRes, "GitHub Authentication failed");
      expect(formatted).toContain("403");
      expect(formatted).toContain("Auth failed");
      expect(formatted).toContain("Resource not accessible");
    });

    it("formats 5xx server error with GitHub service unavailable and truncates large HTML", async () => {
      const largeHtml =
        "<html><body><h1>503 Service Unavailable</h1>" +
        "<p>Internal incident description</p>".repeat(40) +
        "</body></html>";
      const serverRes = new Response(largeHtml, { status: 503, statusText: "Service Unavailable" });

      const formatted = await formatApiError(serverRes, "Failed to fetch Gist");
      expect(formatted).toContain("503");
      expect(formatted).toContain("GitHub service unavailable");
      expect(formatted.length).toBeLessThan(350);
      expect(formatted).toContain("...");
    });

    it("includes scope remediation hint when AxiosError response headers show missing repo scope", async () => {
      const axiosErr = new AxiosError(
        "Request failed with status code 403",
        "ERR_BAD_REQUEST",
        {} as any,
        null,
        {
          status: 403,
          statusText: "Forbidden",
          headers: {
            "x-oauth-scopes": "gist",
            "x-accepted-oauth-scopes": "repo"
          },
          data: {
            message: "Resource not accessible by personal access token"
          },
          config: {} as any
        }
      );

      const formatted = await formatApiError(axiosErr, "Failed to create repository");
      expect(formatted).toContain("Failed to create repository");
      expect(formatted).toContain("403");
      expect(formatted).toContain("Auth failed: Resource not accessible");
      expect(formatted).toContain("Current token scopes: [gist], required: [repo]");
      expect(formatted).toContain("Add 'repo' scope at https://github.com/settings/tokens/new?scopes=gist,repo");
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
      mockHandler = () => ({ status: 200, data: mockGistResponse });

      const result = await GitHubClient.fetchGist("https://gist.github.com/octocat/abc12345");

      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
      expect(result.files["smcp.json"].content).toBe('{"name":"pack","version":"1.0.0"}');
      expect(result.files["SKILL.md"].content).toBe("# Skill content");
    });

    it("extracts Gist ID from URL with trailing slash", async () => {
      mockHandler = () => ({ status: 200, data: mockGistResponse });

      await GitHubClient.fetchGist("https://gist.github.com/octocat/abc12345/");
      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
    });

    it("extracts Gist ID from URL with #file-readme-md hash fragment", async () => {
      mockHandler = () => ({ status: 200, data: mockGistResponse });

      await GitHubClient.fetchGist("https://gist.github.com/octocat/abc12345#file-readme-md");
      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
    });

    it("extracts Gist ID from URL with ?raw=true search query", async () => {
      mockHandler = () => ({ status: 200, data: mockGistResponse });

      await GitHubClient.fetchGist("https://gist.github.com/octocat/abc12345?raw=true");
      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
    });

    it("extracts Gist ID from URL with .git suffix", async () => {
      mockHandler = () => ({ status: 200, data: mockGistResponse });

      await GitHubClient.fetchGist("https://gist.github.com/octocat/abc12345.git");
      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
    });

    it("extracts Gist ID from URL with .git suffix, search query, and hash fragment combined", async () => {
      mockHandler = () => ({ status: 200, data: mockGistResponse });

      await GitHubClient.fetchGist("https://gist.github.com/octocat/abc12345.git?raw=true#file-smcp-json");
      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
    });

    it("extracts Gist ID from raw ID string", async () => {
      mockHandler = () => ({ status: 200, data: mockGistResponse });

      await GitHubClient.fetchGist("abc12345");
      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
    });

    it("extracts Gist ID from URL without username (https://gist.github.com/123456)", async () => {
      mockHandler = () => ({ status: 200, data: mockGistResponse });

      await GitHubClient.fetchGist("https://gist.github.com/abc12345");
      expect(lastRequest?.url).toBe("https://api.github.com/gists/abc12345");
    });

    it("omits Authorization header when token is not provided", async () => {
      mockHandler = () => ({ status: 200, data: mockGistResponse });

      await GitHubClient.fetchGist("abc12345");

      const headers = lastRequest?.headers || {};
      expect(headers["Authorization"]).toBeUndefined();
      expect(headers["User-Agent"]).toBe("smcp-cli");
    });

    it("sends Authorization header when token is provided", async () => {
      mockHandler = () => ({ status: 200, data: mockGistResponse });

      await GitHubClient.fetchGist("abc12345", "ghp_authToken999");

      const headers = lastRequest?.headers || {};
      expect(headers["Authorization"]).toBe("Bearer ghp_authToken999");
    });

    it("automatically fetches full content from raw_url when file is truncated (>64KB)", async () => {
      const truncatedGistResponse = {
        id: "abc12345",
        html_url: "https://gist.github.com/octocat/abc12345",
        files: {
          "smcp.json": {
            filename: "smcp.json",
            truncated: true,
            raw_url: "https://gist.githubusercontent.com/octocat/abc12345/raw/smcp.json",
            content: '{"name":"pack","partially_truncated":'
          },
          "SKILL.md": {
            filename: "SKILL.md",
            truncated: false,
            content: "# Complete Skill"
          }
        }
      };

      mockHandler = (config) => {
        if (config.url === "https://gist.githubusercontent.com/octocat/abc12345/raw/smcp.json") {
          return { status: 200, data: '{"name":"pack","version":"1.0.0"}' };
        }
        return { status: 200, data: truncatedGistResponse };
      };

      const result = await GitHubClient.fetchGist("abc12345");
      expect(result.files["smcp.json"].truncated).toBe(false);
      expect(result.files["smcp.json"].content).toBe('{"name":"pack","version":"1.0.0"}');
      expect(result.files["SKILL.md"].content).toBe("# Complete Skill");
    });

    it("handles 404 Not Found error when gist does not exist", async () => {
      mockHandler = () => ({
        status: 404,
        statusText: "Not Found",
        data: { message: "Not Found" }
      });

      await expect(GitHubClient.fetchGist("abcdef1234567890")).rejects.toThrow(/404/);
    });

    it("throws an error if gist ID cannot be parsed or is empty", async () => {
      await expect(GitHubClient.fetchGist("")).rejects.toThrow(/invalid gist id/i);
      await expect(GitHubClient.fetchGist("   ")).rejects.toThrow(/invalid gist id/i);
    });

    it("rejects non-hex / non-alphanumeric Gist IDs", async () => {
      await expect(GitHubClient.fetchGist("invalid_gist_id!")).rejects.toThrow(/invalid gist id/i);
      await expect(GitHubClient.fetchGist("not-hex-id")).rejects.toThrow(/invalid gist id/i);
      await expect(GitHubClient.fetchGist("https://gist.github.com/octocat/not-hex-gist")).rejects.toThrow(/invalid gist id/i);
    });
  });

  describe("parseGistId helper", () => {
    it("parses valid hex IDs directly", () => {
      expect(parseGistId("abc123def456")).toBe("abc123def456");
      expect(parseGistId("123456")).toBe("123456");
    });

    it("parses full URL with scheme", () => {
      expect(parseGistId("https://gist.github.com/user/6a1b2c3d4e")).toBe("6a1b2c3d4e");
      expect(parseGistId("https://gist.github.com/user/6a1b2c3d4e.git")).toBe("6a1b2c3d4e");
      expect(parseGistId("https://gist.github.com/user/6a1b2c3d4e?raw=true#file-test")).toBe("6a1b2c3d4e");
    });
  });

  describe("Singleton Axios instance & cache invalidation", () => {
    it("reuses identical Axios instance across multiple new GitHubClient() calls with same token", () => {
      const client1 = new GitHubClient("ghp_sharedToken123");
      const client2 = new GitHubClient("ghp_sharedToken123");
      expect(client1.client).toBe(client2.client);
    });

    it("reuses identical Axios instance across createGitHubAxios() calls", () => {
      const ax1 = createGitHubAxios("ghp_sharedToken123");
      const ax2 = createGitHubAxios("ghp_sharedToken123");
      expect(ax1).toBe(ax2);
    });

    it("shares Axios instance between new GitHubClient() and createGitHubAxios()", () => {
      const client = new GitHubClient("ghp_sharedToken123");
      const ax = createGitHubAxios("ghp_sharedToken123");
      expect(client.client).toBe(ax);
    });

    it("reuses Axios instance when token is omitted (anonymous client)", () => {
      const anon1 = new GitHubClient();
      const anon2 = new GitHubClient();
      const anonAx = createGitHubAxios();
      expect(anon1.client).toBe(anon2.client);
      expect(anon1.client).toBe(anonAx);
    });

    it("creates different Axios instances for different tokens", () => {
      const clientA = new GitHubClient("ghp_tokenA");
      const clientB = new GitHubClient("ghp_tokenB");
      expect(clientA.client).not.toBe(clientB.client);
    });

    it("creates different Axios instances for different baseURL or timeoutMs options", () => {
      const clientBase = new GitHubClient("ghp_configToken", { timeoutMs: 5000 });
      const clientDiffTimeout = new GitHubClient("ghp_configToken", { timeoutMs: 10000 });
      const clientDiffBaseUrl = new GitHubClient("ghp_configToken", { baseURL: "https://enterprise.internal/api" });

      expect(clientDiffTimeout.client).not.toBe(clientBase.client);
      expect(clientDiffBaseUrl.client).not.toBe(clientBase.client);
    });

    it("converts numeric timeout option and reuses same instance as object timeout option", () => {
      const clientNum = new GitHubClient("ghp_configToken", 8000);
      const clientObj = new GitHubClient("ghp_configToken", { timeoutMs: 8000 });
      expect(clientNum.client).toBe(clientObj.client);
    });

    it("supports explicit axiosInstance injection in new GitHubClient()", () => {
      const customAxios = axios.create();
      const injectedClient = new GitHubClient("ghp_token", { axiosInstance: customAxios });
      expect(injectedClient.client).toBe(customAxios);
    });

    it("supports explicit axiosInstance injection in createGitHubAxios()", () => {
      const customAxios = axios.create();
      const injectedAx = createGitHubAxios("ghp_token", { axiosInstance: customAxios });
      expect(injectedAx).toBe(customAxios);
    });

    it("supports explicit axiosInstance injection in GitHubClient.fetchGist()", async () => {
      const customAxios = axios.create();
      let capturedUrl = "";
      customAxios.get = async (url: string) => {
        capturedUrl = url;
        return {
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
          data: {
            id: "abc12345",
            html_url: "https://gist.github.com/abc12345",
            files: {}
          }
        } as any;
      };

      const res = await GitHubClient.fetchGist("abc12345", undefined, { axiosInstance: customAxios });
      expect(res.id).toBe("abc12345");
      expect(capturedUrl).toBe("/gists/abc12345");
    });

    it("does not cache explicitly injected axiosInstance", () => {
      const customAxios = axios.create();
      new GitHubClient("ghp_injectCheck", { axiosInstance: customAxios });
      const standardClient = new GitHubClient("ghp_injectCheck");
      expect(standardClient.client).not.toBe(customAxios);
    });

    it("invalidates cache when clearGitHubClientCache() is called", () => {
      const before = new GitHubClient("ghp_cacheToken");
      clearGitHubClientCache();
      const after = new GitHubClient("ghp_cacheToken");
      expect(after.client).not.toBe(before.client);

      const after2 = new GitHubClient("ghp_cacheToken");
      expect(after2.client).toBe(after.client);
    });

    it("invalidates cache when setDefaultAxiosAdapter() is called", () => {
      const before = new GitHubClient("ghp_adapterToken");
      setDefaultAxiosAdapter(async (config) => ({
        status: 200,
        data: {},
        statusText: "OK",
        headers: {},
        config
      } as any));

      const after = new GitHubClient("ghp_adapterToken");
      expect(after.client).not.toBe(before.client);
    });
  });

  describe("GitHub Repository Support", () => {
    it("parseGitHubRepo parses full HTTPS URLs with or without .git and tree branches", () => {
      const parsed1 = parseGitHubRepo("https://github.com/TanPhat23/my-pack");
      expect(parsed1).toEqual({ owner: "TanPhat23", repo: "my-pack" });

      const parsed2 = parseGitHubRepo("https://github.com/TanPhat23/my-pack.git");
      expect(parsed2).toEqual({ owner: "TanPhat23", repo: "my-pack" });

      const parsed3 = parseGitHubRepo("https://github.com/TanPhat23/my-pack/tree/v1.0.0/sub/folder");
      expect(parsed3).toEqual({
        owner: "TanPhat23",
        repo: "my-pack",
        ref: "v1.0.0",
        subpath: "sub/folder"
      });
    });

    it("parseGitHubRepo parses github: shorthand and owner/repo shorthand", () => {
      const parsed1 = parseGitHubRepo("github:owner/agent-pack#feat-branch");
      expect(parsed1).toEqual({
        owner: "owner",
        repo: "agent-pack",
        ref: "feat-branch",
        subpath: undefined
      });

      const parsedSub = parseGitHubRepo("github:owner/agent-pack/sub/path#v2.1");
      expect(parsedSub).toEqual({
        owner: "owner",
        repo: "agent-pack",
        ref: "v2.1",
        subpath: "sub/path"
      });

      const parsed2 = parseGitHubRepo("octocat/hello-world");
      expect(parsed2).toEqual({
        owner: "octocat",
        repo: "hello-world",
        ref: undefined
      });

      const parsedTrailing = parseGitHubRepo("https://github.com/octocat/hello-world/");
      expect(parsedTrailing).toEqual({
        owner: "octocat",
        repo: "hello-world"
      });
    });

    it("parseGitHubRepo rejects invalid or non-repo inputs", () => {
      expect(parseGitHubRepo("")).toBeNull();
      expect(parseGitHubRepo("not a repo")).toBeNull();
      expect(parseGitHubRepo("https://gist.github.com/octocat/1234567890abcdef")).toBeNull();
      expect(parseGitHubRepo("https://gitlab.com/octocat/hello-world")).toBeNull();
      expect(parseGitHubRepo("https://example.com/not-github")).toBeNull();
    });

    it("isRepoSource correctly identifies repository sources", () => {
      expect(isRepoSource("https://github.com/octocat/hello-world")).toBe(true);
      expect(isRepoSource("github:octocat/hello-world")).toBe(true);
      expect(isRepoSource("octocat/hello-world")).toBe(true);
      expect(isRepoSource("1234567890abcdef1234567890abcdef")).toBe(false);
      expect(isRepoSource("")).toBe(false);
    });

    it("generatePackReadme generates clean markdown documentation with install commands", () => {
      const readme = generatePackReadme(
        {
          name: "test-stack",
          version: "1.0.0",
          description: "A great agent stack",
          mcpServers: { myServer: { command: "node server.js" } },
          skills: [{ name: "my-skill", path: "skills/my-skill/SKILL.md", description: "Does things" }],
          plugins: ["my-plugin"]
        },
        "octocat/test-stack"
      );

      expect(readme).toContain("# test-stack");
      expect(readme).toContain("A great agent stack");
      expect(readme).toContain("smcp install https://github.com/octocat/test-stack");
      expect(readme).toContain("- **myServer**");
      expect(readme).toContain("- **my-skill**: Does things");
      expect(readme).toContain("- **my-plugin**");
    });

    it("fetchRepoPack loads manifest and skills from GitHub repository tree", async () => {
      mockHandler = (config) => {
        const url = config.url || "";
        if (url.includes("/repos/octocat/my-pack/git/trees/main")) {
          return {
            status: 200,
            data: {
              sha: "tree_sha",
              tree: [
                { path: "smcp.json", type: "blob", sha: "smcp_blob_sha", url: "blob_url" },
                { path: "skills/test-skill/SKILL.md", type: "blob", sha: "skill_blob_sha", url: "blob_url" },
                { path: "README.md", type: "blob", sha: "readme_sha", url: "blob_url" }
              ]
            }
          };
        }
        if (url.includes("/git/blobs/smcp_blob_sha")) {
          return {
            status: 200,
            data: {
              encoding: "base64",
              content: Buffer.from(
                JSON.stringify({
                  name: "repo-pack",
                  version: "1.0.0",
                  description: "Pack in repo"
                })
              ).toString("base64")
            }
          };
        }
        if (url.includes("/git/blobs/skill_blob_sha")) {
          return {
            status: 200,
            data: {
              encoding: "base64",
              content: Buffer.from("# Repo Skill Content").toString("base64")
            }
          };
        }
        if (url.includes("/repos/octocat/my-pack")) {
          return {
            status: 200,
            data: { default_branch: "main" }
          };
        }
        return { status: 404, data: {} };
      };

      const result = await GitHubClient.fetchRepoPack("octocat/my-pack");
      expect(result.manifest.name).toBe("repo-pack");
      expect(result.manifest.version).toBe("1.0.0");
      expect(result.rawFiles["skills/test-skill/SKILL.md"]).toBe("# Repo Skill Content");
      expect(result.rawFiles["skills_test-skill_SKILL.md"]).toBe("# Repo Skill Content");
    });

    it("createRepository and commitFilesToRepo commit files via Git Data API", async () => {
      const client = new GitHubClient("ghp_testToken");
      let createdTree = false;
      let createdCommit = false;
      let updatedRef = false;

      mockHandler = (config) => {
        const url = config.url || "";
        const method = (config.method || "get").toLowerCase();

        if (url.endsWith("/repos/octocat/new-pack") && method === "get") {
          return { status: 404, data: {} };
        }
        if (url.endsWith("/user/repos") && method === "post") {
          return {
            status: 201,
            data: {
              id: 999,
              name: "new-pack",
              full_name: "octocat/new-pack",
              html_url: "https://github.com/octocat/new-pack",
              default_branch: "main"
            }
          };
        }
        if (url.endsWith("/git/ref/heads/main") && method === "get") {
          return { status: 200, data: { object: { sha: "base_commit_sha" } } };
        }
        if (url.includes("/git/commits/base_commit_sha") && method === "get") {
          return { status: 200, data: { tree: { sha: "base_tree_sha" } } };
        }
        if (url.endsWith("/git/trees") && method === "post") {
          createdTree = true;
          return { status: 201, data: { sha: "new_tree_sha" } };
        }
        if (url.endsWith("/git/commits") && method === "post") {
          createdCommit = true;
          return { status: 201, data: { sha: "new_commit_sha" } };
        }
        if (url.endsWith("/git/refs/heads/main") && method === "patch") {
          updatedRef = true;
          return { status: 200, data: { object: { sha: "new_commit_sha" } } };
        }

        return { status: 200, data: {} };
      };

      const res = await client.commitFilesToRepo({
        owner: "octocat",
        repo: "new-pack",
        branch: "main",
        message: "Initial smcp release",
        files: {
          "smcp.json": '{"name":"new-pack","version":"1.0.0"}',
          "skills/my-skill/SKILL.md": "# Skill"
        }
      });

      expect(createdTree).toBe(true);
      expect(createdCommit).toBe(true);
      expect(updatedRef).toBe(true);
      expect(res.commitSha).toBe("new_commit_sha");
      expect(res.html_url).toBe("https://github.com/octocat/new-pack");
    });

    it("getRepository returns repo metadata or null on 404", async () => {
      const client = new GitHubClient("ghp_token");

      mockHandler = (config) => {
        const url = config.url || "";
        if (url.includes("/repos/octocat/exists")) {
          return {
            status: 200,
            data: {
              id: 123,
              name: "exists",
              full_name: "octocat/exists",
              html_url: "https://github.com/octocat/exists",
              default_branch: "main"
            }
          };
        }
        return { status: 404, statusText: "Not Found", data: {} };
      };

      const found = await client.getRepository("octocat", "exists");
      expect(found).not.toBeNull();
      expect(found?.full_name).toBe("octocat/exists");

      const notFound = await client.getRepository("octocat", "nonexistent");
      expect(notFound).toBeNull();
    });

    it("getRepository throws on non-404 error", async () => {
      const client = new GitHubClient("ghp_token");
      mockHandler = () => ({ status: 500, statusText: "Server Error", data: "Internal error" });

      await expect(client.getRepository("octocat", "error-repo")).rejects.toThrow(
        /Failed to get repository octocat\/error-repo/
      );
    });

    it("createRepository creates user repo or organization repo", async () => {
      const client = new GitHubClient("ghp_token");
      let calledEndpoint = "";

      mockHandler = (config) => {
        calledEndpoint = config.url || "";
        return {
          status: 201,
          data: {
            id: 1,
            name: "new-repo",
            full_name: "octocat/new-repo",
            html_url: "https://github.com/octocat/new-repo",
            default_branch: "main"
          }
        };
      };

      // User repo
      await client.createRepository({ name: "user-pack", description: "desc" });
      expect(calledEndpoint).toContain("/user/repos");

      // Org repo
      await client.createRepository({ name: "org-pack", org: "my-org" });
      expect(calledEndpoint).toContain("/orgs/my-org/repos");
    });

    it("commitFilesToRepo normalizes Windows backslashes and creates branch if not existing", async () => {
      const client = new GitHubClient("ghp_token");
      let treeEntries: Array<{ path: string }> = [];
      let createdRefWithPost = false;

      mockHandler = (config) => {
        const url = config.url || "";
        const method = (config.method || "get").toLowerCase();

        if (url.endsWith("/repos/octocat/existing-repo") && method === "get") {
          return {
            status: 200,
            data: {
              id: 555,
              name: "existing-repo",
              full_name: "octocat/existing-repo",
              html_url: "https://github.com/octocat/existing-repo",
              default_branch: "main"
            }
          };
        }
        // Ref does not exist yet (404 on GET)
        if (url.includes("/git/ref/heads/feature") && method === "get") {
          return { status: 404, data: {} };
        }
        if (url.includes("/git/ref/heads/main") && method === "get") {
          return { status: 404, data: {} };
        }
        if (url.endsWith("/git/trees") && method === "post") {
          const payload = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
          treeEntries = payload.tree || [];
          return { status: 201, data: { sha: "new_tree" } };
        }
        if (url.endsWith("/git/commits") && method === "post") {
          return { status: 201, data: { sha: "new_commit" } };
        }
        if (url.endsWith("/git/refs") && method === "post") {
          createdRefWithPost = true;
          return { status: 201, data: {} };
        }
        return { status: 200, data: {} };
      };

      const res = await client.commitFilesToRepo({
        owner: "octocat",
        repo: "existing-repo",
        branch: "feature",
        message: "feat: initial files",
        files: {
          "smcp.json": "{}",
          "skills\\demo\\SKILL.md": "# Demo",
          "plugins\\sample\\index.ts": "export {}"
        }
      });

      expect(createdRefWithPost).toBe(true);
      expect(res.branch).toBe("feature");
      expect(treeEntries.some((e) => e.path === "skills/demo/SKILL.md")).toBe(true);
      expect(treeEntries.some((e) => e.path === "plugins/sample/index.ts")).toBe(true);
      expect(treeEntries.some((e) => e.path.includes("\\"))).toBe(false);
    });

    it("fetchRepoFileContent decodes blob and falls back to raw URL on blob error", async () => {
      const client = new GitHubClient("ghp_token");

      mockHandler = (config) => {
        const url = config.url || "";
        if (url.includes("/git/blobs/valid_blob")) {
          return {
            status: 200,
            data: {
              encoding: "base64",
              content: Buffer.from("Hello from blob").toString("base64")
            }
          };
        }
        if (url.includes("/git/blobs/failing_blob")) {
          return { status: 500, data: "Blob service error" };
        }
        if (url.includes("raw.githubusercontent.com/octocat/my-repo/main/fallback.txt")) {
          return { status: 200, data: "Hello from raw fallback" };
        }
        return { status: 404, data: {} };
      };

      const fromBlob = await GitHubClient.fetchRepoFileContent(
        client.client,
        "octocat",
        "my-repo",
        "main",
        "valid.txt",
        "valid_blob"
      );
      expect(fromBlob).toBe("Hello from blob");

      const fromFallback = await GitHubClient.fetchRepoFileContent(
        client.client,
        "octocat",
        "my-repo",
        "main",
        "fallback.txt",
        "failing_blob"
      );
      expect(fromFallback).toBe("Hello from raw fallback");
    });

    it("fetchRepoPack loads packs located in a subpath with plugins and flat keys", async () => {
      mockHandler = (config) => {
        const url = config.url || "";
        if (url.includes("/git/trees/feat-branch")) {
          return {
            status: 200,
            data: {
              sha: "tree_sub",
              tree: [
                { path: "packages/my-pack/smcp.json", type: "blob", sha: "blob_sub_manifest", url: "" },
                { path: "packages/my-pack/skills/analyzer/SKILL.md", type: "blob", sha: "blob_sub_skill", url: "" },
                { path: "packages/my-pack/plugins/tools/index.ts", type: "blob", sha: "blob_sub_plugin", url: "" }
              ]
            }
          };
        }
        if (url.includes("/git/blobs/blob_sub_manifest")) {
          return {
            status: 200,
            data: {
              encoding: "base64",
              content: Buffer.from(
                JSON.stringify({
                  name: "subpath-pack",
                  version: "1.5.0",
                  plugins: ["tools"]
                })
              ).toString("base64")
            }
          };
        }
        if (url.includes("/git/blobs/blob_sub_skill")) {
          return {
            status: 200,
            data: {
              encoding: "base64",
              content: Buffer.from("# Subpath Skill").toString("base64")
            }
          };
        }
        if (url.includes("/git/blobs/blob_sub_plugin")) {
          return {
            status: 200,
            data: {
              encoding: "base64",
              content: Buffer.from("export const plugin = true;").toString("base64")
            }
          };
        }
        return { status: 404, data: {} };
      };

      const result = await GitHubClient.fetchRepoPack(
        "https://github.com/octocat/monorepo/tree/feat-branch/packages/my-pack"
      );
      expect(result.manifest.name).toBe("subpath-pack");
      expect(result.ref).toBe("feat-branch");
      expect(result.rawFiles["skills/analyzer/SKILL.md"]).toBe("# Subpath Skill");
      expect(result.rawFiles["skills_analyzer_SKILL.md"]).toBe("# Subpath Skill");
      expect(result.rawFiles["plugins/tools/index.ts"]).toBe("export const plugin = true;");
      expect(result.rawFiles["plugins_tools_index.ts"]).toBe("export const plugin = true;");
    });

    it("fetchRepoPack throws error when smcp.json is missing or invalid in repository", async () => {
      // 1. Missing smcp.json
      mockHandler = (config) => {
        const url = config.url || "";
        if (url.includes("/repos/octocat/no-manifest")) {
          return { status: 200, data: { default_branch: "main" } };
        }
        if (url.includes("/git/trees/main")) {
          return {
            status: 200,
            data: {
              sha: "tree_sha",
              tree: [{ path: "README.md", type: "blob", sha: "blob_1", url: "" }]
            }
          };
        }
        return { status: 404, data: {} };
      };

      await expect(GitHubClient.fetchRepoPack("octocat/no-manifest")).rejects.toThrow(
        /does not contain an smcp.json manifest file/
      );

      // 2. Corrupted smcp.json (invalid JSON)
      mockHandler = (config) => {
        const url = config.url || "";
        if (url.includes("/repos/octocat/corrupt-pack")) {
          return { status: 200, data: { default_branch: "main" } };
        }
        if (url.includes("/git/trees/main")) {
          return {
            status: 200,
            data: {
              sha: "tree_sha",
              tree: [{ path: "smcp.json", type: "blob", sha: "blob_corrupt", url: "" }]
            }
          };
        }
        if (url.includes("/git/blobs/blob_corrupt")) {
          return {
            status: 200,
            data: {
              encoding: "base64",
              content: Buffer.from("not valid json content").toString("base64")
            }
          };
        }
        return { status: 404, data: {} };
      };

      await expect(GitHubClient.fetchRepoPack("octocat/corrupt-pack")).rejects.toThrow(
        /Failed to load GitHub repository pack/
      );
    });
  });
});
