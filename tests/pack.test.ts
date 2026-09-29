import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GitHubClient, setDefaultAxiosAdapter } from "../src/core/github.ts";
import { collectRequiredEnv, loadPackFromSource } from "../src/core/pack/index.ts";
import type { Manifest } from "../src/types/index.ts";

describe("Pack Loader & Required Env Collector (src/core/pack.ts)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), "smcp-pack-test-" + Date.now() + "-" + Math.random().toString(36).slice(2));
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    setDefaultAxiosAdapter(undefined);
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe("loadPackFromSource", () => {
    it("throws if source is empty or whitespace", async () => {
      await expect(loadPackFromSource("")).rejects.toThrow("Source path or URL is required.");
      await expect(loadPackFromSource("   ")).rejects.toThrow("Source path or URL is required.");
    });

    it("throws if source does not exist locally and is not a valid Gist", async () => {
      await expect(loadPackFromSource("/non/existent/path/here")).rejects.toThrow(
        "Unsupported source: /non/existent/path/here"
      );
    });

    it("loads from a local directory containing smcp.json", async () => {
      const manifest: Manifest = {
        name: "test-pack",
        version: "1.0.0",
        description: "A local pack"
      };
      fs.writeFileSync(path.join(tmpDir, "smcp.json"), JSON.stringify(manifest), "utf8");

      const loaded = await loadPackFromSource(tmpDir);
      expect(loaded.manifest.name).toBe("test-pack");
      expect(loaded.localDir).toBe(path.resolve(tmpDir));
    });

    it("loads from a direct smcp.json file path", async () => {
      const manifest: Manifest = {
        name: "file-pack",
        version: "2.0.0"
      };
      const filePath = path.join(tmpDir, "custom-pack.json");
      fs.writeFileSync(filePath, JSON.stringify(manifest), "utf8");

      const loaded = await loadPackFromSource(filePath);
      expect(loaded.manifest.name).toBe("file-pack");
      expect(loaded.localDir).toBe(path.resolve(tmpDir));
    });

    it("throws if local directory lacks smcp.json", async () => {
      await expect(loadPackFromSource(tmpDir)).rejects.toThrow(/smcp.json manifest not found/);
    });

    it("loads from a Gist URL using GitHubClient", async () => {
      const manifest: Manifest = {
        name: "gist-pack",
        version: "1.2.3"
      };
      setDefaultAxiosAdapter(async (config) => {
        return {
          data: {
            id: "1234567890abcdef1234567890abcdef",
            html_url: "https://gist.github.com/octocat/1234567890abcdef1234567890abcdef",
            files: {
              "smcp.json": { content: JSON.stringify(manifest) },
              "SKILL.md": { content: "# My Skill" }
            }
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config
        } as any;
      });

      const loaded = await loadPackFromSource("https://gist.github.com/octocat/1234567890abcdef1234567890abcdef");
      expect(loaded.manifest.name).toBe("gist-pack");
      expect(loaded.manifest.version).toBe("1.2.3");
      expect(loaded.rawFiles["SKILL.md"]).toBe("# My Skill");
    });

    it("throws if Gist does not contain an smcp.json file", async () => {
      setDefaultAxiosAdapter(async (config) => {
        return {
          data: {
            id: "1234567890abcdef1234567890abcdef",
            html_url: "https://gist.github.com/octocat/1234567890abcdef1234567890abcdef",
            files: {
              "README.md": { content: "No manifest here" }
            }
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config
        } as any;
      });

      await expect(
        loadPackFromSource("https://gist.github.com/octocat/1234567890abcdef1234567890abcdef")
      ).rejects.toThrow("Gist does not contain an smcp.json manifest file.");
    });

    it("loads from a GitHub repository URL", async () => {
      setDefaultAxiosAdapter(async (config) => {
        const url = config.url || "";
        if (url.includes("/repos/octocat/my-agent-repo/git/trees/main")) {
          return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: {
              sha: "tree_sha_1",
              tree: [
                { path: "smcp.json", type: "blob", sha: "blob_manifest", url: "url" },
                { path: "skills/test/SKILL.md", type: "blob", sha: "blob_skill", url: "url" }
              ]
            }
          } as any;
        }
        if (url.includes("/git/blobs/blob_manifest")) {
          return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: {
              encoding: "base64",
              content: Buffer.from(
                JSON.stringify({
                  name: "repo-pack",
                  version: "2.0.0",
                  description: "Repo loaded pack"
                })
              ).toString("base64")
            }
          } as any;
        }
        if (url.includes("/git/blobs/blob_skill")) {
          return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: {
              encoding: "base64",
              content: Buffer.from("# Repo Skill").toString("base64")
            }
          } as any;
        }
        if (url.includes("/repos/octocat/my-agent-repo")) {
          return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: { default_branch: "main" }
          } as any;
        }
        return { status: 404, statusText: "Not Found", headers: {}, config, data: {} } as any;
      });

      const loaded = await loadPackFromSource("https://github.com/octocat/my-agent-repo");
      expect(loaded.manifest.name).toBe("repo-pack");
      expect(loaded.manifest.version).toBe("2.0.0");
      expect(loaded.rawFiles["skills/test/SKILL.md"]).toBe("# Repo Skill");
    });

    it("throws if GitHub repository does not contain smcp.json", async () => {
      setDefaultAxiosAdapter(async (config) => {
        const url = config.url || "";
        if (url.includes("/repos/octocat/empty-repo/git/trees/main")) {
          return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: {
              sha: "tree_empty",
              tree: [{ path: "README.md", type: "blob", sha: "blob_readme", url: "url" }]
            }
          } as any;
        }
        if (url.includes("/repos/octocat/empty-repo")) {
          return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: { default_branch: "main" }
          } as any;
        }
        return { status: 404, statusText: "Not Found", headers: {}, config, data: {} } as any;
      });

      await expect(loadPackFromSource("https://github.com/octocat/empty-repo")).rejects.toThrow(
        /does not contain an smcp.json manifest file/
      );
    });

    it("loads from owner/repo shorthand and github: prefix", async () => {
      setDefaultAxiosAdapter(async (config) => {
        const url = config.url || "";
        if (url.includes("/git/trees/v1.0")) {
          return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: {
              sha: "tree_shorthand",
              tree: [{ path: "smcp.json", type: "blob", sha: "blob_short", url: "" }]
            }
          } as any;
        }
        if (url.includes("/git/blobs/blob_short")) {
          return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: {
              encoding: "base64",
              content: Buffer.from(
                JSON.stringify({
                  name: "shorthand-pack",
                  version: "3.0.0"
                })
              ).toString("base64")
            }
          } as any;
        }
        return { status: 404, data: {} } as any;
      });

      const loaded = await loadPackFromSource("github:octocat/shorthand-repo#v1.0");
      expect(loaded.manifest.name).toBe("shorthand-pack");
      expect(loaded.manifest.version).toBe("3.0.0");
    });

    it("prioritizes existing local directory over repo shorthand", async () => {
      const localOwnerDir = path.join(tmpDir, "local-owner");
      const localRepoDir = path.join(localOwnerDir, "local-repo");
      fs.mkdirSync(localRepoDir, { recursive: true });
      fs.writeFileSync(
        path.join(localRepoDir, "smcp.json"),
        JSON.stringify({
          name: "local-priority-pack",
          version: "1.0.0"
        }),
        "utf8"
      );

      // Pass the relative-looking or absolute local path
      const loaded = await loadPackFromSource(localRepoDir);
      expect(loaded.manifest.name).toBe("local-priority-pack");
      expect(loaded.localDir).toBe(path.resolve(localRepoDir));
    });

    it("throws descriptive error for unsupported sources", async () => {
      await expect(loadPackFromSource("invalid:source:pattern:here")).rejects.toThrow(
        /Unsupported source: invalid:source:pattern:here/
      );
    });
  });

  describe("collectRequiredEnv", () => {
    it("collects explicit requiredEnv from manifest and placeholder variables from mcpServers", () => {
      const manifest: Manifest = {
        name: "complex-pack",
        version: "1.0.0",
        requiredEnv: [
          { key: "EXPLICIT_VAR", description: "Explicit description", isSecret: false }
        ],
        mcpServers: {
          database: {
            command: "npx",
            args: ["--url", "${DB_URL}", "--flag"],
            env: {
              API_KEY: "${DB_API_KEY}",
              SAFE_ENV: "static-value"
            },
            url: "http://${SERVER_HOST}:8080/mcp"
          }
        }
      };

      const collected = collectRequiredEnv(manifest);
      const keys = collected.map((c) => c.key);

      expect(keys).toContain("EXPLICIT_VAR");
      expect(keys).toContain("DB_URL");
      expect(keys).toContain("DB_API_KEY");
      expect(keys).toContain("SERVER_HOST");

      const apiKeyItem = collected.find((c) => c.key === "DB_API_KEY");
      expect(apiKeyItem?.isSecret).toBe(true);

      const dbUrlItem = collected.find((c) => c.key === "DB_URL");
      expect(dbUrlItem?.isSecret).toBe(false);
    });

    it("does not duplicate variables when already declared in requiredEnv", () => {
      const manifest: Manifest = {
        name: "duplicate-pack",
        version: "1.0.0",
        requiredEnv: [
          { key: "MY_TOKEN", description: "Primary token", isSecret: true }
        ],
        mcpServers: {
          srv: {
            command: "run",
            env: {
              TOKEN: "${MY_TOKEN}"
            }
          }
        }
      };

      const collected = collectRequiredEnv(manifest);
      expect(collected.filter((c) => c.key === "MY_TOKEN")).toHaveLength(1);
      expect(collected[0].description).toBe("Primary token");
    });
  });
});
