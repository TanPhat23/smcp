// tests/git-providers-github.test.ts
import { describe, expect, it } from "bun:test";
import axios, { type AxiosInstance } from "axios";
import {
  GitHubGitProvider,
  GitHubClient,
  parseGitHubRepo,
  parseGistId,
  isRepoSource,
  createGitHubAxios,
  formatApiError,
  generatePackReadme,
  DEFAULT_TIMEOUT_MS,
  defaultGitHubGitProvider
} from "../packages/core/src/core/git-providers/github/index.ts";
import { resolveGitProviderForSource } from "../packages/core/src/core/git-providers/registry.ts";

describe("Modular GitHub Provider", () => {
  it("implements GitProvider interface and parses GitHub repos", () => {
    const provider = new GitHubGitProvider();
    expect(provider.id).toBe("github");
    expect(provider.matchesRepo("github:owner/repo")).toBe(true);
    expect(provider.matchesRepo("owner/repo")).toBe(true);
    expect(provider.matchesRepo("https://github.com/owner/repo")).toBe(true);
    expect(provider.matchesSnippet?.("https://gist.github.com/owner/1234567890abcdef")).toBe(true);

    const ref = provider.parseRepo("github:owner/repo#v1.0.0");
    expect(ref).toEqual({
      provider: "github",
      host: "github.com",
      owner: "owner",
      repo: "repo",
      ref: "v1.0.0",
      subpath: undefined
    });
  });

  it("exports backward-compatible GitHubClient and helpers", () => {
    expect(typeof parseGistId).toBe("function");
    expect(typeof parseGitHubRepo).toBe("function");
    expect(typeof isRepoSource).toBe("function");
    expect(typeof createGitHubAxios).toBe("function");
    expect(typeof formatApiError).toBe("function");
    expect(typeof generatePackReadme).toBe("function");
    expect(typeof GitHubClient).toBe("function");
    expect(DEFAULT_TIMEOUT_MS).toBe(60000);
    expect(defaultGitHubGitProvider).toBeInstanceOf(GitHubGitProvider);
  });

  it("parses complex repo sources including subpaths and branches", () => {
    const provider = new GitHubGitProvider();
    const parsedTree = provider.parseRepo("https://github.com/owner/repo/tree/feat-1/sub/dir");
    expect(parsedTree).toEqual({
      provider: "github",
      host: "github.com",
      owner: "owner",
      repo: "repo",
      ref: "feat-1",
      subpath: "sub/dir"
    });

    const parsedInvalid = provider.parseRepo("https://gitlab.com/owner/repo");
    expect(parsedInvalid).toBeNull();
  });

  it("matches and parses snippet references", () => {
    const provider = new GitHubGitProvider();
    expect(provider.matchesSnippet("gist:a1b2c3d4e5f607182930a1b2c3d4e5f6")).toBe(true);
    expect(provider.matchesSnippet("https://gist.github.com/user/a1b2c3d4e5f607182930a1b2c3d4e5f6")).toBe(true);
    expect(provider.matchesSnippet("https://github.com/owner/repo")).toBe(false);

    const snippetRef1 = provider.parseSnippet("gist:a1b2c3d4e5f607182930a1b2c3d4e5f6");
    expect(snippetRef1).toEqual({
      provider: "github",
      host: "github.com",
      snippetId: "a1b2c3d4e5f607182930a1b2c3d4e5f6"
    });

    const snippetRef2 = provider.parseSnippet("https://gist.github.com/user/1234567890abcdef1234567890abcdef");
    expect(snippetRef2).toEqual({
      provider: "github",
      host: "github.com",
      snippetId: "1234567890abcdef1234567890abcdef"
    });

    expect(provider.parseSnippet("not-a-gist")).toBeNull();
  });

  it("resolves through git-providers registry for GitHub sources", () => {
    const provider = resolveGitProviderForSource("github:user/awesome-pack");
    expect(provider).toBeDefined();
    expect(provider?.id).toBe("github");

    const gistProvider = resolveGitProviderForSource("https://gist.github.com/user/1234567890abcdef");
    expect(gistProvider).toBeDefined();
    expect(gistProvider?.id).toBe("github");
  });

  it("verifies user authentication and returns AuthUser contract", async () => {
    const mockAxiosInstance = {
      get: async (url: string) => {
        if (url === "/user") {
          return {
            data: { login: "testdev", name: "Test Developer", id: 12345 },
            headers: { "x-oauth-scopes": "gist, repo" }
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      }
    } as unknown as AxiosInstance;

    const client = new GitHubClient("fake-token", { axiosInstance: mockAxiosInstance });
    const userRes = await client.verifyUser();
    expect(userRes.login).toBe("testdev");
    expect(userRes.hasRepoScope).toBe(true);
    expect(userRes.hasGistScope).toBe(true);

    const provider = new GitHubGitProvider();
    // Verify verifyUser method exists and adheres to interface
    expect(typeof provider.verifyUser).toBe("function");
  });
});
