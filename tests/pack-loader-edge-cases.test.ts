import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveMcpServerTemplates } from "../packages/cli/src/commands/install/templates.ts";
import { collectRequiredEnv, loadPackFromSource } from "../packages/core/src/core/pack/index.ts";
import type { Manifest, McpServerConfig } from "../packages/core/src/types/index.ts";

describe("Pack Loader, Env Collection & Template Resolution Edge Cases", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      "smcp-pack-edge-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("loadPackFromSource edge cases", () => {
    it("prioritizes local directory over GitHub repo shorthand when directory exists", async () => {
      // Create local folder named "owner/repo"
      const localOwnerRepoDir = path.join(tmpDir, "owner", "repo");
      fs.mkdirSync(localOwnerRepoDir, { recursive: true });

      const manifestContent: Manifest = {
        name: "local-owner-repo-pack",
        version: "1.0.0",
        description: "Local directory with repo-like path"
      };
      fs.writeFileSync(
        path.join(localOwnerRepoDir, "smcp.json"),
        JSON.stringify(manifestContent, null, 2),
        "utf8"
      );

      const loaded = await loadPackFromSource(localOwnerRepoDir);
      expect(loaded.manifest.name).toBe("local-owner-repo-pack");
    });

    it("throws descriptive error when smcp.json contains invalid syntax", async () => {
      const corruptPackDir = path.join(tmpDir, "corrupt-pack");
      fs.mkdirSync(corruptPackDir, { recursive: true });
      fs.writeFileSync(path.join(corruptPackDir, "smcp.json"), "{ invalid syntax", "utf8");

      await expect(loadPackFromSource(corruptPackDir)).rejects.toThrow();
    });

    it("throws descriptive error when directory lacks smcp.json", async () => {
      const emptyDir = path.join(tmpDir, "empty-pack");
      fs.mkdirSync(emptyDir, { recursive: true });

      await expect(loadPackFromSource(emptyDir)).rejects.toThrow(/smcp\.json manifest not found/);
    });
  });

  describe("collectRequiredEnv deep multi-vector extraction", () => {
    it("extracts all placeholder variables across command, args, env, url, and headers", () => {
      const manifest: Manifest = {
        name: "all-vectors-pack",
        version: "1.0.0",
        requiredEnv: [
          { key: "EXPLICIT_CONFIG", description: "Already declared", isSecret: false }
        ],
        mcpServers: {
          vectorServer: {
            command: "run --mode=${RUN_MODE}",
            args: ["--token", "${ARG_TOKEN}", "--host", "${SERVER_HOST}"],
            env: {
              API_KEY: "${ENV_API_KEY}",
              PUBLIC_FLAG: "${PUBLIC_VAL}"
            },
            url: "https://${SERVER_HOST}:${SERVER_PORT}/mcp",
            headers: {
              Authorization: "Bearer ${AUTH_BEARER}",
              "X-Custom-Secret": "${X_SECRET}"
            }
          } as any
        }
      };

      const collected = collectRequiredEnv(manifest);
      const keys = collected.map((c) => c.key);

      expect(keys).toContain("EXPLICIT_CONFIG");
      expect(keys).toContain("RUN_MODE");
      expect(keys).toContain("ARG_TOKEN");
      expect(keys).toContain("SERVER_HOST");
      expect(keys).toContain("ENV_API_KEY");
      expect(keys).toContain("PUBLIC_VAL");
      expect(keys).toContain("SERVER_PORT");
      expect(keys).toContain("AUTH_BEARER");
      expect(keys).toContain("X_SECRET");

      // Verify no duplicates
      expect(new Set(keys).size).toBe(keys.length);

      // Verify secret categorization
      const authBearer = collected.find((c) => c.key === "AUTH_BEARER");
      expect(authBearer?.isSecret).toBe(true);

      const apiKey = collected.find((c) => c.key === "ENV_API_KEY");
      expect(apiKey?.isSecret).toBe(true);

      const explicit = collected.find((c) => c.key === "EXPLICIT_CONFIG");
      expect(explicit?.isSecret).toBe(false);
    });
  });

  describe("resolveMcpServerTemplates edge cases", () => {
    it("replaces multiple placeholders in a single string", () => {
      const servers: Record<string, McpServerConfig> = {
        multiTemplate: {
          url: "${PROTOCOL}://${HOST}:${PORT}/events?auth=${TOKEN}"
        }
      };

      const envValues = {
        PROTOCOL: "https",
        HOST: "internal.net",
        PORT: "9000",
        TOKEN: "tok_secret"
      };

      const resolved = resolveMcpServerTemplates(servers, envValues);
      expect(resolved.multiTemplate.url).toBe("https://internal.net:9000/events?auth=tok_secret");
    });

    it("handles empty string env values by replacing placeholders with empty string", () => {
      const servers: Record<string, McpServerConfig> = {
        emptyValServer: {
          command: "node ${EXTRA_FLAGS} app.js",
          env: {
            OPTIONAL_VAR: "${OPTIONAL_VAR}"
          }
        }
      };

      const envValues = {
        EXTRA_FLAGS: "",
        OPTIONAL_VAR: ""
      };

      const resolved = resolveMcpServerTemplates(servers, envValues);
      expect(resolved.emptyValServer.command).toBe("node  app.js");
      expect(resolved.emptyValServer.env?.OPTIONAL_VAR).toBe("");
    });

    it("preserves undefined placeholder variables unchanged", () => {
      const servers: Record<string, McpServerConfig> = {
        partialServer: {
          command: "node server.js --port ${DEFINED_PORT} --key ${UNDEFINED_KEY}"
        }
      };

      const envValues = {
        DEFINED_PORT: "8080"
      };

      const resolved = resolveMcpServerTemplates(servers, envValues);
      expect(resolved.partialServer.command).toBe("node server.js --port 8080 --key ${UNDEFINED_KEY}");
    });

    it("resolves placeholders in command arrays (OpenCode schema)", () => {
      const servers: Record<string, McpServerConfig> = {
        opencodeServer: {
          command: ["bunx", "-y", "runner", "--token", "${RUNNER_TOKEN}", "--host", "${HOST}"] as any
        }
      };

      const envValues = {
        RUNNER_TOKEN: "tok_xyz",
        HOST: "localhost"
      };

      const resolved = resolveMcpServerTemplates(servers, envValues);
      expect(resolved.opencodeServer.command).toEqual([
        "bunx",
        "-y",
        "runner",
        "--token",
        "tok_xyz",
        "--host",
        "localhost"
      ] as any);
    });
  });
});
