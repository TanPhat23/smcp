// tests/plugin-s3-extension.test.ts
import { describe, expect, it } from "bun:test";
import { loadPackFromSource } from "../packages/core/src/core/pack/loader.ts";
import { registerPackLoader, unregisterPackLoader } from "../packages/core/src/core/pack/registry.ts";
import {
  registerShareProvider,
  unregisterShareProvider,
  getShareProvider,
  type ShareProvider,
  type ShareProviderContext
} from "../packages/cli/src/commands/share/providers/index.ts";

describe("Custom Remote Plugin Extension (S3 pattern)", () => {
  it("allows registering an external S3 pack loader without modifying core", async () => {
    registerPackLoader(
      {
        name: "s3-mock",
        matches: (ctx) => ctx.source.startsWith("s3://"),
        load: async (ctx) => ({
          manifest: {
            name: "s3-pack",
            version: "1.0.0",
            skills: []
          },
          rawFiles: { "smcp.json": "{}" }
        })
      },
      true
    );

    const loaded = await loadPackFromSource("s3://my-corp-bucket/packs/backend");
    expect(loaded.manifest.name).toBe("s3-pack");
    unregisterPackLoader("s3-mock");
  });

  it("allows registering an external S3 share provider dynamically", async () => {
    let publishedBucket = "";
    let publishedKey = "";

    const s3ShareProvider: ShareProvider = {
      id: "s3",
      label: "AWS S3 / MinIO Storage",
      hint: "Uploads pack bundle tarball or json to an S3-compatible bucket",
      publish: async (ctx: ShareProviderContext) => {
        publishedBucket = "my-corp-bucket";
        publishedKey = `packs/${ctx.cleanPackName}-v${ctx.version}.json`;
        return true;
      }
    };

    registerShareProvider(s3ShareProvider, true);

    const resolved = getShareProvider("s3");
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe("s3");
    expect(resolved?.label).toBe("AWS S3 / MinIO Storage");

    const result = await resolved?.publish({
      cleanPackName: "enterprise-agents",
      version: "2.1.0"
    } as any);

    expect(result).toBe(true);
    expect(publishedBucket).toBe("my-corp-bucket");
    expect(publishedKey).toBe("packs/enterprise-agents-v2.1.0.json");

    unregisterShareProvider("s3");
    expect(getShareProvider("s3")).toBeNull();
  });

  it("delegates loadPackFromSource to registered GitProvider for GitLab sources", async () => {
    // Before Task 5 update to pack/registry.ts, this will fail or throw unsupported source
    // unless gitlab is routed via resolveGitProviderForSource in GitRepoPackLoader.
    const customGitLabProvider = {
      id: "gitlab-test",
      name: "GitLab Test",
      defaultHost: "gitlab.com",
      matchesRepo: (source: string) => source.startsWith("gitlab:test-group/"),
      parseRepo: (source: string) => {
        if (!source.startsWith("gitlab:test-group/")) return null;
        return {
          provider: "gitlab-test",
          host: "gitlab.com",
          owner: "test-group",
          repo: source.replace("gitlab:test-group/", "")
        };
      },
      fetchRepoPack: async () => ({
        manifest: {
          name: "gitlab-routed-pack",
          version: "1.0.0"
        },
        rawFiles: { "README.md": "From GitLab provider" }
      }),
      verifyUser: async () => ({ username: "gitlab-user" })
    };

    const { registerGitProvider, unregisterGitProvider } = await import(
      "../packages/core/src/core/git-providers/index.ts"
    );

    registerGitProvider(customGitLabProvider as any, true);

    try {
      const loaded = await loadPackFromSource("gitlab:test-group/routed-pack");
      expect(loaded.manifest.name).toBe("gitlab-routed-pack");
      expect(loaded.rawFiles["README.md"]).toBe("From GitLab provider");
    } finally {
      unregisterGitProvider("gitlab-test");
    }
  });

  it("delegates loadPackFromSource to registered GitProvider for Gitea / Codeberg sources", async () => {
    const customGiteaProvider = {
      id: "gitea-test",
      name: "Gitea Test",
      defaultHost: "codeberg.org",
      matchesRepo: (source: string) => source.startsWith("codeberg:test-user/"),
      parseRepo: (source: string) => {
        if (!source.startsWith("codeberg:test-user/")) return null;
        return {
          provider: "gitea-test",
          host: "codeberg.org",
          owner: "test-user",
          repo: source.replace("codeberg:test-user/", "")
        };
      },
      fetchRepoPack: async () => ({
        manifest: {
          name: "codeberg-routed-pack",
          version: "2.5.0"
        },
        rawFiles: { "SKILL.md": "# Codeberg Skill" }
      }),
      verifyUser: async () => ({ username: "codeberg-user" })
    };

    const { registerGitProvider, unregisterGitProvider } = await import(
      "../packages/core/src/core/git-providers/index.ts"
    );

    registerGitProvider(customGiteaProvider as any, true);

    try {
      const loaded = await loadPackFromSource("codeberg:test-user/my-pack");
      expect(loaded.manifest.name).toBe("codeberg-routed-pack");
      expect(loaded.manifest.version).toBe("2.5.0");
      expect(loaded.rawFiles["SKILL.md"]).toBe("# Codeberg Skill");
    } finally {
      unregisterGitProvider("gitea-test");
    }
  });

  it("delegates loadPackFromSource to registered GitProvider for snippet sources", async () => {
    const customSnippetProvider = {
      id: "snippet-test",
      name: "Snippet Test",
      defaultHost: "snippets.internal",
      matchesRepo: () => false,
      parseRepo: () => null,
      matchesSnippet: (source: string) => source.startsWith("https://snippets.internal/"),
      parseSnippet: (source: string) => {
        if (!source.startsWith("https://snippets.internal/")) return null;
        return {
          provider: "snippet-test",
          host: "snippets.internal",
          snippetId: source.replace("https://snippets.internal/", "")
        };
      },
      fetchSnippetPack: async () => ({
        manifest: {
          name: "custom-snippet-pack",
          version: "1.0.0"
        },
        rawFiles: { "smcp.json": "{}" },
        snippetId: "snip-999"
      }),
      fetchRepoPack: async () => { throw new Error("not used"); },
      verifyUser: async () => ({ username: "snippet-user" })
    };

    const { registerGitProvider, unregisterGitProvider } = await import(
      "../packages/core/src/core/git-providers/index.ts"
    );

    registerGitProvider(customSnippetProvider as any, true);

    try {
      const loaded = await loadPackFromSource("https://snippets.internal/snip-999");
      expect(loaded.manifest.name).toBe("custom-snippet-pack");
      expect(loaded.manifest.version).toBe("1.0.0");
    } finally {
      unregisterGitProvider("snippet-test");
    }
  });

  it("preserves backward-compatible PackLoader classes and aliases", async () => {
    const {
      GitRepoPackLoader,
      GitHubRepoPackLoader,
      SnippetPackLoader,
      GistPackLoader
    } = await import("../packages/core/src/core/pack/registry.ts");

    expect(GitRepoPackLoader).toBeDefined();
    expect(GitHubRepoPackLoader).toBeDefined();
    expect(SnippetPackLoader).toBeDefined();
    expect(GistPackLoader).toBeDefined();

    const gitRepoLoader = new GitRepoPackLoader();
    expect(gitRepoLoader.name).toBe("git-repo");

    const githubRepoLoader = new GitHubRepoPackLoader();
    expect(githubRepoLoader instanceof GitRepoPackLoader).toBe(true);

    const snippetLoader = new SnippetPackLoader();
    expect(snippetLoader.name).toBe("git-snippet");

    const gistLoader = new GistPackLoader();
    expect(gistLoader instanceof SnippetPackLoader).toBe(true);
  });
});
