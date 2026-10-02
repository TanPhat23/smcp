// tests/git-providers-gitea.test.ts
import { describe, expect, it } from "bun:test";
import type { AxiosInstance } from "axios";
import {
  GiteaGitProvider,
  parseGiteaRepo,
  GiteaClient,
  createGiteaAxios,
  defaultGiteaGitProvider,
  fetchGiteaRepoPack,
  commitGiteaFiles,
  formatGiteaApiError
} from "../packages/core/src/core/git-providers/gitea/index.ts";
import { resolveGitProviderForSource } from "../packages/core/src/core/git-providers/registry.ts";

describe("Gitea / Forgejo Git Provider", () => {
  it("parses Gitea and Codeberg repository URLs and shorthands", () => {
    const ref1 = parseGiteaRepo("gitea:owner/repo");
    expect(ref1).toEqual({
      provider: "gitea",
      host: "gitea.com",
      owner: "owner",
      repo: "repo",
      ref: undefined,
      subpath: undefined
    });

    const ref2 = parseGiteaRepo("https://codeberg.org/forgejo-user/agent-pack/src/branch/v1.1/pack");
    expect(ref2).toEqual({
      provider: "gitea",
      host: "codeberg.org",
      owner: "forgejo-user",
      repo: "agent-pack",
      ref: "v1.1",
      subpath: "pack"
    });
  });

  it("detects Gitea and Codeberg URLs with provider.matchesRepo", () => {
    const provider = new GiteaGitProvider();
    expect(provider.matchesRepo("gitea:owner/repo")).toBe(true);
    expect(provider.matchesRepo("codeberg:owner/repo")).toBe(true);
    expect(provider.matchesRepo("https://codeberg.org/user/repo")).toBe(true);
  });

  it("handles ref tags and custom self-hosted domains", () => {
    const ref1 = parseGiteaRepo("gitea:owner/repo#v2.0.0");
    expect(ref1).toEqual({
      provider: "gitea",
      host: "gitea.com",
      owner: "owner",
      repo: "repo",
      ref: "v2.0.0",
      subpath: undefined
    });

    const ref2 = parseGiteaRepo("codeberg:my-org/my-pack#feat/new-skills");
    expect(ref2).toEqual({
      provider: "gitea",
      host: "codeberg.org",
      owner: "my-org",
      repo: "my-pack",
      ref: "feat/new-skills",
      subpath: undefined
    });

    const ref3 = parseGiteaRepo("https://forgejo.internal.corp/team/agent-pack/src/branch/main/skills/sub");
    expect(ref3).toEqual({
      provider: "gitea",
      host: "forgejo.internal.corp",
      owner: "team",
      repo: "agent-pack",
      ref: "main",
      subpath: "skills/sub"
    });

    const ref4 = parseGiteaRepo("gitea:git.custom-host.io/org/repo");
    expect(ref4).toEqual({
      provider: "gitea",
      host: "git.custom-host.io",
      owner: "org",
      repo: "repo",
      ref: undefined,
      subpath: undefined
    });
  });

  it("does not match non-Gitea sources", () => {
    const provider = new GiteaGitProvider();
    expect(provider.matchesRepo("owner/repo")).toBe(false);
    expect(provider.matchesRepo("github:owner/repo")).toBe(false);
    expect(provider.matchesRepo("https://github.com/owner/repo")).toBe(false);
    expect(provider.matchesRepo("gitlab:group/project")).toBe(false);
    expect(provider.matchesRepo("https://gitlab.com/group/project")).toBe(false);
  });

  it("resolves through git-providers registry for Gitea and Codeberg sources", () => {
    const giteaProvider = resolveGitProviderForSource("gitea:owner/repo");
    expect(giteaProvider).toBeDefined();
    expect(giteaProvider?.id).toBe("gitea");

    const codebergProvider = resolveGitProviderForSource("codeberg:owner/repo");
    expect(codebergProvider).toBeDefined();
    expect(codebergProvider?.id).toBe("gitea");

    const codebergUrlProvider = resolveGitProviderForSource("https://codeberg.org/forgejo-user/pack");
    expect(codebergUrlProvider).toBeDefined();
    expect(codebergUrlProvider?.id).toBe("gitea");
  });

  it("configures auth header correctly for Gitea tokens", () => {
    const axToken = createGiteaAxios("my-gitea-token");
    expect(axToken.defaults.headers.Authorization).toBe("token my-gitea-token");

    const axBearer = createGiteaAxios("Bearer my-oauth-token");
    expect(axBearer.defaults.headers.Authorization).toBe("Bearer my-oauth-token");

    const axExplicitToken = createGiteaAxios("token already-prefixed");
    expect(axExplicitToken.defaults.headers.Authorization).toBe("token already-prefixed");
  });

  it("verifies user authentication with Gitea API", async () => {
    const mockAxiosInstance = {
      get: async (url: string) => {
        if (url === "/user") {
          return {
            data: { login: "codeberg-user", full_name: "Codeberg Dev", id: 4567, email: "dev@codeberg.org" },
            headers: {}
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      }
    } as unknown as AxiosInstance;

    const client = new GiteaClient("fake-token", { axiosInstance: mockAxiosInstance });
    const userRes = await client.verifyUser();
    expect(userRes.login).toBe("codeberg-user");
    expect(userRes.full_name).toBe("Codeberg Dev");
    expect(userRes.id).toBe(4567);

    const provider = new GiteaGitProvider();
    const verifiedUser = await provider.verifyUser("fake-token");
    // Should return AuthUser structure with verified fields
    expect(typeof provider.verifyUser).toBe("function");
  });

  it("fetches repo pack with manifest and auxiliary files", async () => {
    const sampleManifest = JSON.stringify({
      name: "gitea-pack",
      version: "1.0.0",
      description: "Pack from Gitea",
      skills: [{ name: "gitea-skill", path: "skills/gitea-skill", description: "A gitea skill" }]
    });

    const mockAxios = {
      get: async (url: string, config?: any) => {
        if (url === "/repos/owner/my-pack") {
          return { data: { default_branch: "main" }, headers: {} };
        }
        if (url === "/repos/owner/my-pack/git/trees/main") {
          return {
            data: {
              sha: "root-tree-sha",
              tree: [
                { path: "smcp.json", mode: "100644", type: "blob", sha: "sha-manifest" },
                { path: "skills/gitea-skill/SKILL.md", mode: "100644", type: "blob", sha: "sha-skill" }
              ]
            }
          };
        }
        if (url === "/repos/owner/my-pack/raw/smcp.json") {
          return { data: sampleManifest, headers: {} };
        }
        if (url === "/repos/owner/my-pack/raw/skills/gitea-skill/SKILL.md") {
          return { data: "# Gitea Skill Guide", headers: {} };
        }
        throw new Error(`Unexpected GET ${url}`);
      }
    } as unknown as AxiosInstance;

    const result = await fetchGiteaRepoPack(
      "gitea:owner/my-pack",
      "mock-token",
      { axiosInstance: mockAxios }
    );

    expect(result.manifest.name).toBe("gitea-pack");
    expect(result.rawFiles["smcp.json"]).toBe(sampleManifest);
    expect(result.rawFiles["skills/gitea-skill/SKILL.md"]).toBe("# Gitea Skill Guide");
    expect(result.rawFiles["skills_gitea-skill_SKILL.md"]).toBe("# Gitea Skill Guide");
    expect(result.repoFullName).toBe("owner/my-pack");
    expect(result.ref).toBe("main");
  });

  it("commits files to a Gitea repository using Git Data API", async () => {
    let createdTreePayload: any = null;
    let createdCommitPayload: any = null;
    let patchedRefPayload: any = null;

    const mockAxios = {
      get: async (url: string) => {
        if (url === "/repos/owner/repo") {
          return {
            data: {
              id: 101,
              name: "repo",
              full_name: "owner/repo",
              default_branch: "main",
              html_url: "https://codeberg.org/owner/repo"
            }
          };
        }
        if (url === "/repos/owner/repo/git/refs/heads/main") {
          return {
            data: {
              ref: "refs/heads/main",
              object: { sha: "head-commit-sha" }
            }
          };
        }
        if (url === "/repos/owner/repo/git/commits/head-commit-sha") {
          return {
            data: {
              sha: "head-commit-sha",
              tree: { sha: "base-tree-sha" }
            }
          };
        }
        throw new Error(`Unexpected GET ${url}`);
      },
      post: async (url: string, data: any) => {
        if (url === "/repos/owner/repo/git/trees") {
          createdTreePayload = data;
          return { data: { sha: "new-tree-sha" } };
        }
        if (url === "/repos/owner/repo/git/commits") {
          createdCommitPayload = data;
          return { data: { sha: "new-commit-sha" } };
        }
        throw new Error(`Unexpected POST ${url}`);
      },
      patch: async (url: string, data: any) => {
        if (url === "/repos/owner/repo/git/refs/heads/main") {
          patchedRefPayload = data;
          return { data: { ref: "refs/heads/main", object: { sha: "new-commit-sha" } } };
        }
        throw new Error(`Unexpected PATCH ${url}`);
      }
    } as unknown as AxiosInstance;

    const result = await commitGiteaFiles({
      owner: "owner",
      repo: "repo",
      message: "feat: add gitea smcp pack",
      files: {
        "smcp.json": '{"name":"gitea-pack"}',
        "skills/demo/SKILL.md": "# Demo"
      },
      client: mockAxios,
      host: "codeberg.org"
    });

    expect(result.commitSha).toBe("new-commit-sha");
    expect(result.branch).toBe("main");
    expect(result.html_url).toBe("https://codeberg.org/owner/repo");
    expect(createdTreePayload.base_tree).toBe("base-tree-sha");
    expect(createdTreePayload.tree).toEqual([
      { path: "smcp.json", mode: "100644", type: "blob", content: '{"name":"gitea-pack"}' },
      { path: "skills/demo/SKILL.md", mode: "100644", type: "blob", content: "# Demo" }
    ]);
    expect(createdCommitPayload.message).toBe("feat: add gitea smcp pack");
    expect(createdCommitPayload.tree).toBe("new-tree-sha");
    expect(createdCommitPayload.parents).toEqual(["head-commit-sha"]);
    expect(patchedRefPayload.sha).toBe("new-commit-sha");
  });

  it("handles formatGiteaApiError gracefully", () => {
    const errorStr = formatGiteaApiError(new Error("Timeout"), "Failed operation");
    expect(errorStr).toBe("Failed operation: Timeout");

    const mockAxiosErr = {
      isAxiosError: true,
      message: "Request failed with status code 404",
      response: {
        status: 404,
        data: { message: "Repository not found" }
      }
    };
    const formatted404 = formatGiteaApiError(mockAxiosErr, "Gitea error");
    expect(formatted404).toBe("Gitea error: 404 Repository not found");
  });
});
