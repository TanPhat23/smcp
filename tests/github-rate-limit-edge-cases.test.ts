import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  clearGitHubClientCache,
  formatApiError,
  GitHubClient,
  setDefaultAxiosAdapter
} from "../packages/core/src/core/github.ts";

describe("GitHubClient Rate Limiting, Network Failures & Truncated HTML", () => {
  beforeEach(() => {
    clearGitHubClientCache();
  });

  afterEach(() => {
    clearGitHubClientCache();
  });

  it("formats HTTP 429 rate limit errors with API message", async () => {
    const errorObj = {
      isAxiosError: true,
      response: {
        status: 429,
        statusText: "Too Many Requests",
        headers: {
          "retry-after": "60",
          "x-ratelimit-remaining": "0"
        },
        data: {
          message: "API rate limit exceeded for user ID 12345",
          documentation_url: "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting"
        }
      }
    };

    const formatted = await formatApiError(errorObj, "Failed to fetch pack");
    expect(formatted).toContain("429");
    expect(formatted).toContain("API rate limit exceeded");
  });

  it("formats HTTP 403 secondary rate limit errors cleanly", async () => {
    const errorObj = {
      isAxiosError: true,
      response: {
        status: 403,
        statusText: "Forbidden",
        headers: {
          "retry-after": "120"
        },
        data: {
          message: "You have triggered an abuse detection mechanism. Please wait a few minutes before trying again."
        }
      }
    };

    const formatted = await formatApiError(errorObj, "Failed to export");
    expect(formatted).toContain("403");
    expect(formatted).toContain("Auth failed: You have triggered an abuse detection mechanism");
  });

  it("truncates massive HTML error pages (e.g. 50KB Cloudflare or Nginx error) to prevent log flooding", async () => {
    const massiveHtml = "<html><body><h1>502 Bad Gateway</h1>" + "<p>Cloudflare error details</p>".repeat(2000) + "</body></html>";
    const errorObj = {
      isAxiosError: true,
      response: {
        status: 502,
        statusText: "Bad Gateway",
        headers: {
          "content-type": "text/html"
        },
        data: massiveHtml
      }
    };

    const formatted = await formatApiError(errorObj, "GitHub API unavailable");
    expect(formatted).toContain("502");
    expect(formatted).toContain("GitHub service unavailable");
    // Verify output length is constrained (well under 50KB)
    expect(formatted.length).toBeLessThan(1000);
  });

  it("formats raw system network errors (ECONNREFUSED, ENOTFOUND, ETIMEDOUT)", async () => {
    const connRefused = new Error("connect ECONNREFUSED 127.0.0.1:443");
    const notFound = new Error("getaddrinfo ENOTFOUND api.github.com");
    const timedOut = new Error("connect ETIMEDOUT 140.82.121.4:443");

    expect(await formatApiError(connRefused, "Request failed")).toBe("Request failed: connect ECONNREFUSED 127.0.0.1:443");
    expect(await formatApiError(notFound, "Request failed")).toBe("Request failed: getaddrinfo ENOTFOUND api.github.com");
    expect(await formatApiError(timedOut, "Request failed")).toBe("Request failed: connect ETIMEDOUT 140.82.121.4:443");
  });

  it("handles non-error thrown values like string, null, or number gracefully", async () => {
    expect(await formatApiError("server error string", "Failed")).toBe("Failed: server error string");
    expect(await formatApiError(null, "Failed")).toBe("Failed: null");
    expect(await formatApiError(undefined, "Failed")).toBe("Failed: undefined");
    expect(await formatApiError(500, "Failed")).toBe("Failed: 500");
  });

  it("fetches full content from raw_url when gist file is marked truncated (>64KB)", async () => {
    setDefaultAxiosAdapter(async (config) => {
      const url = config.url || "";
      if (url.includes("/gists/abcdef1234567890abcdef1234567890")) {
        return {
          status: 200,
          statusText: "OK",
          headers: {},
          config,
          data: {
            id: "abcdef1234567890abcdef1234567890",
            files: {
              "smcp.json": {
                filename: "smcp.json",
                truncated: true,
                raw_url: "https://gist.githubusercontent.com/raw/smcp.json",
                content: "" // empty because truncated
              }
            }
          }
        } as any;
      }
      if (url === "https://gist.githubusercontent.com/raw/smcp.json") {
        return {
          status: 200,
          statusText: "OK",
          headers: {},
          config,
          data: JSON.stringify({
            name: "large-pack",
            version: "1.0.0",
            description: "Pack with large files"
          })
        } as any;
      }
      return { status: 404, statusText: "Not Found", headers: {}, config, data: {} } as any;
    });

    const result = await GitHubClient.fetchGist("abcdef1234567890abcdef1234567890");
    expect(result.files["smcp.json"]).toBeDefined();
    expect(result.files["smcp.json"].content).toContain("large-pack");
    expect(result.files["smcp.json"].truncated).toBe(false);
  });
});
