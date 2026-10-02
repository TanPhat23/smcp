// tests/git-providers-gitlab.test.ts
import { describe, expect, it } from "bun:test";
import type { AxiosInstance } from "axios";
import {
  GitLabGitProvider,
  parseGitLabRepo,
  parseGitLabSnippet,
  GitLabClient,
  createGitLabAxios,
  defaultGitLabGitProvider,
  fetchGitLabRepoPack,
  fetchGitLabSnippetPack,
  commitGitLabFiles,
  publishGitLabSnippet,
  formatGitLabApiError
} from "../packages/core/src/core/git-providers/gitlab/index.ts";
import { resolveGitProviderForSource } from "../packages/core/src/core/git-providers/registry.ts";

describe("GitLab Git Provider", () => {
  it("parses GitLab repository URLs and shorthands", () => {
    const ref1 = parseGitLabRepo("gitlab:my-group/my-pack");
    expect(ref1).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      owner: "my-group",
      repo: "my-pack",
      ref: undefined,
      subpath: undefined
    });

    const ref2 = parseGitLabRepo("https://gitlab.com/group/subgroup/project/-/tree/v2.0/subdir");
    expect(ref2).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      owner: "group/subgroup",
      repo: "project",
      ref: "v2.0",
      subpath: "subdir"
    });
  });

  it("parses GitLab snippet URLs and shorthands", () => {
    const snip = parseGitLabSnippet("https://gitlab.com/-/snippets/1234567");
    expect(snip).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      snippetId: "1234567"
    });

    const snip2 = parseGitLabSnippet("gitlab-snippet:7654321");
    expect(snip2).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      snippetId: "7654321"
    });

    const snip3 = parseGitLabSnippet("gitlab:snippet/999888");
    expect(snip3).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      snippetId: "999888"
    });
  });

  it("detects GitLab URLs with provider.matchesRepo and matchesSnippet", () => {
    const provider = new GitLabGitProvider();
    expect(provider.matchesRepo("gitlab:group/project")).toBe(true);
    expect(provider.matchesRepo("https://gitlab.com/group/project")).toBe(true);
    expect(provider.matchesSnippet?.("https://gitlab.com/-/snippets/999")).toBe(true);
    // Snippets must not match repo
    expect(provider.matchesRepo("https://gitlab.com/-/snippets/999")).toBe(false);
    // GitHub or general URLs must not match
    expect(provider.matchesRepo("owner/repo")).toBe(false);
    expect(provider.matchesRepo("https://github.com/owner/repo")).toBe(false);
    expect(provider.matchesSnippet?.("https://gist.github.com/123456")).toBe(false);
  });

  it("handles deep namespace groups and refs in shorthands", () => {
    const ref = parseGitLabRepo("gitlab:my-group/subgroup/project#v1.2.0");
    expect(ref).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      owner: "my-group/subgroup",
      repo: "project",
      ref: "v1.2.0",
      subpath: undefined
    });
  });

  it("handles self-hosted GitLab hosts correctly", () => {
    const ref = parseGitLabRepo("https://gitlab.corp.internal/enterprise/agent-pack/-/tree/main/subfolder");
    expect(ref).toEqual({
      provider: "gitlab",
      host: "gitlab.corp.internal",
      owner: "enterprise",
      repo: "agent-pack",
      ref: "main",
      subpath: "subfolder"
    });
  });

  it("resolves through git-providers registry for GitLab sources", () => {
    const repoProvider = resolveGitProviderForSource("gitlab:my-group/my-pack");
    expect(repoProvider).toBeDefined();
    expect(repoProvider?.id).toBe("gitlab");

    const snippetProvider = resolveGitProviderForSource("https://gitlab.com/-/snippets/1234567");
    expect(snippetProvider).toBeDefined();
    expect(snippetProvider?.id).toBe("gitlab");
  });

  it("verifies user authentication with GitLab API", async () => {
    const mockAxiosInstance = {
      get: async (url: string) => {
        if (url === "/user") {
          return {
            data: { username: "gitlab-user", name: "GitLab User", id: 98765 },
            headers: {}
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      }
    } as unknown as AxiosInstance;

    const client = new GitLabClient("fake-glpat-token", { axiosInstance: mockAxiosInstance });
    const userRes = await client.verifyUser();
    expect(userRes.username).toBe("gitlab-user");
    expect(userRes.name).toBe("GitLab User");

    const provider = new GitLabGitProvider();
    expect(typeof provider.verifyUser).toBe("function");
  });

  it("fetches repo pack with manifest and auxiliary files", async () => {
    const sampleManifest = JSON.stringify({
      name: "gitlab-pack",
      version: "1.0.0",
      description: "Pack from GitLab",
      skills: [{ name: "my-skill", path: "skills/my-skill", description: "A test skill" }]
    });

    const mockAxios = {
      get: async (url: string, config?: any) => {
        if (url === "/projects/my-group%2Fmy-pack") {
          return { data: { default_branch: "main" }, headers: {} };
        }
        if (url === "/projects/my-group%2Fmy-pack/repository/tree") {
          return {
            data: [
              { id: "b1", name: "smcp.json", type: "blob", path: "smcp.json", mode: "100644" },
              { id: "b2", name: "SKILL.md", type: "blob", path: "skills/my-skill/SKILL.md", mode: "100644" }
            ],
            headers: { "x-next-page": "" }
          };
        }
        if (url === "/projects/my-group%2Fmy-pack/repository/files/smcp.json/raw") {
          return { data: sampleManifest, headers: {} };
        }
        if (url === "/projects/my-group%2Fmy-pack/repository/files/skills%2Fmy-skill%2FSKILL.md/raw") {
          return { data: "# Skill Documentation", headers: {} };
        }
        throw new Error(`Unexpected GET ${url}`);
      }
    } as unknown as AxiosInstance;

    const result = await fetchGitLabRepoPack(
      "gitlab:my-group/my-pack",
      "mock-token",
      { axiosInstance: mockAxios }
    );

    expect(result.manifest.name).toBe("gitlab-pack");
    expect(result.rawFiles["smcp.json"]).toBe(sampleManifest);
    expect(result.rawFiles["skills/my-skill/SKILL.md"]).toBe("# Skill Documentation");
    expect(result.rawFiles["skills_my-skill_SKILL.md"]).toBe("# Skill Documentation");
    expect(result.repoFullName).toBe("my-group/my-pack");
    expect(result.ref).toBe("main");
  });

  it("fetches snippet pack with multi-file snippets", async () => {
    const sampleManifest = JSON.stringify({
      name: "snippet-pack",
      version: "1.0.0"
    });

    const mockAxios = {
      get: async (url: string) => {
        if (url === "/snippets/1234567") {
          return {
            data: {
              id: 1234567,
              title: "My Snippet Pack",
              web_url: "https://gitlab.com/-/snippets/1234567",
              files: [
                { path: "smcp.json", raw_url: "https://gitlab.com/-/snippets/1234567/raw/main/smcp.json" },
                { path: "README.md", raw_url: "https://gitlab.com/-/snippets/1234567/raw/main/README.md" }
              ]
            }
          };
        }
        if (url === "https://gitlab.com/-/snippets/1234567/raw/main/smcp.json") {
          return { data: sampleManifest };
        }
        if (url === "https://gitlab.com/-/snippets/1234567/raw/main/README.md") {
          return { data: "# Readme Content" };
        }
        throw new Error(`Unexpected GET ${url}`);
      }
    } as unknown as AxiosInstance;

    const result = await fetchGitLabSnippetPack(
      "https://gitlab.com/-/snippets/1234567",
      "mock-token",
      { axiosInstance: mockAxios }
    );

    expect(result.manifest.name).toBe("snippet-pack");
    expect(result.rawFiles["smcp.json"]).toBe(sampleManifest);
    expect(result.rawFiles["README.md"]).toBe("# Readme Content");
    expect(result.snippetId).toBe("1234567");
  });

  it("commits files to a GitLab project using commit API", async () => {
    let postedPayload: any = null;
    const mockAxios = {
      get: async (url: string) => {
        if (url === "/projects/my-group%2Fmy-project") {
          return {
            data: {
              id: 42,
              name: "my-project",
              default_branch: "main",
              web_url: "https://gitlab.com/my-group/my-project"
            }
          };
        }
        if (url === "/projects/my-group%2Fmy-project/repository/tree") {
          return {
            data: [
              { id: "b1", name: "smcp.json", type: "blob", path: "smcp.json", mode: "100644" }
            ]
          };
        }
        throw new Error(`Unexpected GET ${url}`);
      },
      post: async (url: string, data: any) => {
        if (url === "/projects/my-group%2Fmy-project/repository/commits") {
          postedPayload = data;
          return {
            data: { id: "commit-sha-abc-123" }
          };
        }
        throw new Error(`Unexpected POST ${url}`);
      }
    } as unknown as AxiosInstance;

    const result = await commitGitLabFiles({
      projectPath: "my-group/my-project",
      message: "feat: update smcp files",
      files: {
        "smcp.json": '{"name":"updated"}',
        "skills/new-skill/SKILL.md": "# New Skill"
      },
      client: mockAxios
    });

    expect(result.commitSha).toBe("commit-sha-abc-123");
    expect(result.branch).toBe("main");
    expect(result.html_url).toBe("https://gitlab.com/my-group/my-project");
    expect(postedPayload).toBeDefined();
    expect(postedPayload.commit_message).toBe("feat: update smcp files");
    // smcp.json was in tree -> action update; skills was not -> action create
    expect(postedPayload.actions).toEqual([
      { action: "update", file_path: "smcp.json", content: '{"name":"updated"}' },
      { action: "create", file_path: "skills/new-skill/SKILL.md", content: "# New Skill" }
    ]);
  });

  it("publishes snippet via GitLab snippets API", async () => {
    const mockAxios = {
      post: async (url: string, data: any) => {
        if (url === "/snippets") {
          expect(data.title).toBe("published-pack");
          expect(data.visibility).toBe("public");
          expect(data.files).toEqual([
            { file_path: "smcp.json", content: "{}" }
          ]);
          return {
            data: { id: 998877, web_url: "https://gitlab.com/-/snippets/998877" }
          };
        }
        throw new Error(`Unexpected POST ${url}`);
      }
    } as unknown as AxiosInstance;

    // Use provider.publishSnippet
    const provider = new GitLabGitProvider();
    const res = await (provider as any).publishSnippet({
      title: "published-pack",
      isPublic: true,
      files: { "smcp.json": "{}" }
    });

    // Also test direct client createGitLabAxios auth headers
    const ax = createGitLabAxios("glpat-secret-token");
    expect(ax.defaults.headers["PRIVATE-TOKEN"]).toBe("glpat-secret-token");

    const bearerAx = createGitLabAxios("Bearer oauth-token");
    expect(bearerAx.defaults.headers.Authorization).toBe("Bearer oauth-token");
  });

  it("handles formatGitLabApiError gracefully for various error payloads", () => {
    const errorStr = formatGitLabApiError(new Error("Network timeout"), "Operation failed");
    expect(errorStr).toBe("Operation failed: Network timeout");

    const mockAxiosErr = {
      isAxiosError: true,
      message: "Request failed",
      response: {
        status: 404,
        data: { message: "404 Project Not Found" }
      }
    };
    const formatted404 = formatGitLabApiError(mockAxiosErr, "GitLab error");
    expect(formatted404).toBe("GitLab error: 404 404 Project Not Found");
  });
});
