import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import {
  clearGistDiskCache,
  readGistCache,
  recordInstalledPack,
  saveAuthConfig,
  setDefaultAxiosAdapter,
  writeGistCache,
  type GistResponse,
  type InstalledPackRecord
} from "@tanphat/smcp-core";
import { createProgram } from "../packages/cli/src/cli.ts";
import { inspectCommand } from "../packages/cli/src/commands/inspect.ts";
import { outdatedCommand } from "../packages/cli/src/commands/outdated.ts";
import { checkPackUpdateStatus } from "../packages/core/src/core/pack/updater.ts";
import { GistShareProvider } from "../packages/cli/src/commands/share/providers/gist.ts";
import type { ShareProviderContext } from "../packages/cli/src/commands/share/providers/types.ts";

describe("Targeted Cache Invalidation & Pre-warming", () => {
  let testDir: string;
  let originalSmcpDir: string | undefined;
  let requestCount = 0;
  let capturedRequests: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  let mockHandler:
    | ((config: InternalAxiosRequestConfig) => {
        status?: number;
        statusText?: string;
        data?: unknown;
        headers?: Record<string, string>;
      })
    | null = null;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-cache-invalidation-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(testDir, { recursive: true });

    originalSmcpDir = process.env.SMCP_DIR;
    process.env.SMCP_DIR = testDir;

    saveAuthConfig({ githubToken: "test-token-12345" });

    requestCount = 0;
    capturedRequests = [];
    mockHandler = null;
    clearGistDiskCache();

    setDefaultAxiosAdapter(async (config) => {
      requestCount++;
      const fullUrl =
        config.baseURL && !config.url?.startsWith("http")
          ? `${config.baseURL.replace(/\/+$/, "")}/${config.url?.replace(/^\/+/, "")}`
          : config.url || "";

      const headersMap: Record<string, string> = {};
      if (config.headers) {
        for (const [k, v] of Object.entries(config.headers)) {
          if (typeof v === "string") {
            headersMap[k] = v;
          }
        }
      }

      capturedRequests.push({
        url: fullUrl,
        method: (config.method || "get").toUpperCase(),
        headers: headersMap
      });

      if (!mockHandler) {
        throw new Error(`No mockHandler defined for request to ${fullUrl}`);
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
          undefined,
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
    clearGistDiskCache();

    if (originalSmcpDir !== undefined) {
      process.env.SMCP_DIR = originalSmcpDir;
    } else {
      delete process.env.SMCP_DIR;
    }

    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("smcp inspect --no-cache", () => {
    it("reads from disk cache by default, and bypasses cache when noCache: true is set", async () => {
      const gistId = "a1b2c3d4e5f607182930a1b2c3d4e5f6";
      const gistUrl = `https://gist.github.com/octocat/${gistId}`;

      // 1. Seed cache with v1.0.0
      const cachedGist: GistResponse = {
        id: gistId,
        html_url: gistUrl,
        description: "[smcp] sample v1.0.0",
        files: {
          "smcp.json": {
            filename: "smcp.json",
            truncated: false,
            content: JSON.stringify({
              name: "inspect-pack",
              version: "1.0.0",
              description: "Cached version 1.0.0"
            })
          }
        }
      };
      writeGistCache(gistId, cachedGist, '"v1-etag"');

      // 2. Setup mock handler to return fresh v2.0.0 if network is hit
      mockHandler = () => ({
        status: 200,
        headers: { etag: '"v2-etag"' },
        data: {
          id: gistId,
          html_url: gistUrl,
          description: "[smcp] sample v2.0.0",
          files: {
            "smcp.json": {
              filename: "smcp.json",
              truncated: false,
              content: JSON.stringify({
                name: "inspect-pack",
                version: "2.0.0",
                description: "Fresh network version 2.0.0"
              })
            }
          }
        }
      });

      // 3. Inspect without noCache -> returns v1.0.0 from cache, 0 network requests
      const resCached = await inspectCommand(gistUrl, { json: true });
      expect(resCached).not.toBeNull();
      expect(resCached?.version).toBe("1.0.0");
      expect(requestCount).toBe(0);

      // 4. Inspect with noCache: true -> bypasses cache, returns fresh v2.0.0
      const resBypassed = await inspectCommand(gistUrl, { json: true, noCache: true });
      expect(resBypassed).not.toBeNull();
      expect(resBypassed?.version).toBe("2.0.0");
      expect(requestCount).toBe(1);

      // 5. Inspect with cache: false (Commander --no-cache CLI option) -> also bypasses cache
      const resCliBypassed = await inspectCommand(gistUrl, { json: true, cache: false });
      expect(resCliBypassed).not.toBeNull();
      expect(resCliBypassed?.version).toBe("2.0.0");
      expect(requestCount).toBe(2);
    });
  });

  describe("checkPackUpdateStatus always revalidates", () => {
    it("passes noCache: true to loadPackFromSource to detect fresh remote versions immediately", async () => {
      const gistId = "b1b2c3d4e5f607182930a1b2c3d4e5f6";
      const gistUrl = `https://gist.github.com/octocat/${gistId}`;

      // 1. Seed disk cache with v1.0.0
      const cachedGist: GistResponse = {
        id: gistId,
        html_url: gistUrl,
        description: "[smcp] my-pack v1.0.0",
        files: {
          "smcp.json": {
            filename: "smcp.json",
            truncated: false,
            content: JSON.stringify({
              name: "my-pack",
              version: "1.0.0"
            })
          }
        }
      };
      writeGistCache(gistId, cachedGist, '"v1-etag"');

      // 2. Mock handler returns v1.5.0 on network fetch
      mockHandler = () => ({
        status: 200,
        headers: { etag: '"v1.5-etag"' },
        data: {
          id: gistId,
          html_url: gistUrl,
          description: "[smcp] my-pack v1.5.0",
          files: {
            "smcp.json": {
              filename: "smcp.json",
              truncated: false,
              content: JSON.stringify({
                name: "my-pack",
                version: "1.5.0"
              })
            }
          }
        }
      });

      const installedRecord: InstalledPackRecord = {
        name: "my-pack",
        source: gistUrl,
        version: "1.0.0",
        targetAgents: ["opencode"],
        installedMcp: [],
        installedSkills: [],
        installedPlugins: [],
        installedAt: new Date().toISOString()
      };

      // 3. checkPackUpdateStatus must bypass the disk cache and fetch v1.5.0
      const updateResult = await checkPackUpdateStatus(installedRecord);

      expect(requestCount).toBe(1);
      expect(updateResult.status).toBe("outdated");
      expect(updateResult.installedVersion).toBe("1.0.0");
      expect(updateResult.latestVersion).toBe("1.5.0");
    });
  });

  describe("GistShareProvider cache pre-warming", () => {
    it("pre-warms the gist cache on createGist so subsequent inspect is instant", async () => {
      const createdGistId = "c1b2c3d4e5f607182930a1b2c3d4e5f6";
      const createdHtmlUrl = `https://gist.github.com/octocat/${createdGistId}`;

      mockHandler = (config) => {
        if (config.method?.toLowerCase() === "post") {
          return {
            status: 201,
            data: {
              id: createdGistId,
              html_url: createdHtmlUrl
            }
          };
        }
        throw new Error(`Unexpected request: ${config.method} ${config.url}`);
      };

      // Verify cache is empty before sharing
      expect(readGistCache(createdGistId)).toBeNull();

      const provider = new GistShareProvider();
      const gistFiles = {
        "smcp.json": {
          content: JSON.stringify({
            name: "prewarmed-pack",
            version: "1.0.0",
            description: "Test pre-warmed pack"
          })
        },
        "skills_greet_SKILL.md": {
          content: "# Greet Skill\nHello from pre-warmed skill!"
        }
      };

      const shareContext: ShareProviderContext = {
        manifest: {
          name: "prewarmed-pack",
          version: "1.0.0",
          description: "Test pre-warmed pack"
        },
        bundledSkills: [],
        bundledPlugins: [],
        bundledAgents: [],
        redactedServers: {},
        selectedServers: [],
        selectedSkills: [],
        selectedPlugins: [],
        selectedAgents: [],
        gistFiles,
        options: { isPublic: true },
        cleanPackName: "prewarmed-pack",
        cleanPackDesc: "Test pre-warmed pack",
        version: "1.0.0",
        isNonInteractive: true,
        isAgentMode: true
      };

      await provider.publish(shareContext);

      // Verify disk cache was immediately pre-warmed
      const cached = readGistCache(createdGistId);
      expect(cached).not.toBeNull();
      expect(cached?.data.id).toBe(createdGistId);
      expect(cached?.data.html_url).toBe(createdHtmlUrl);
      expect(cached?.data.files["smcp.json"]?.content).toBe(gistFiles["smcp.json"].content);
      expect(cached?.data.files["smcp.json"]?.truncated).toBe(false);
      expect(cached?.data.files["skills_greet_SKILL.md"]?.content).toBe(
        gistFiles["skills_greet_SKILL.md"].content
      );
      expect(cached?.data.files["skills_greet_SKILL.md"]?.truncated).toBe(false);

      // Verify that inspect immediately after share uses cache with 0 additional network calls
      const priorCount = requestCount; // 1 POST request was made
      const inspected = await inspectCommand(createdHtmlUrl, { json: true });
      expect(inspected).not.toBeNull();
      expect(inspected?.name).toBe("prewarmed-pack");
      expect(inspected?.version).toBe("1.0.0");
      expect(requestCount).toBe(priorCount); // No GET request was sent!
    });

    it("pre-warms the gist cache on updateGist when targetGistId is provided", async () => {
      const existingGistId = "d1b2c3d4e5f607182930a1b2c3d4e5f6";
      const existingHtmlUrl = `https://gist.github.com/octocat/${existingGistId}`;

      mockHandler = (config) => {
        if (config.method?.toLowerCase() === "patch") {
          return {
            status: 200,
            data: {
              id: existingGistId,
              html_url: existingHtmlUrl
            }
          };
        }
        throw new Error(`Unexpected request: ${config.method} ${config.url}`);
      };

      const provider = new GistShareProvider();
      const gistFiles = {
        "smcp.json": {
          content: JSON.stringify({
            name: "updated-pack",
            version: "2.0.0",
            description: "Updated pack v2"
          })
        }
      };

      const shareContext: ShareProviderContext = {
        manifest: {
          name: "updated-pack",
          version: "2.0.0",
          description: "Updated pack v2"
        },
        bundledSkills: [],
        bundledPlugins: [],
        bundledAgents: [],
        redactedServers: {},
        selectedServers: [],
        selectedSkills: [],
        selectedPlugins: [],
        selectedAgents: [],
        gistFiles,
        options: {},
        cleanPackName: "updated-pack",
        cleanPackDesc: "Updated pack v2",
        version: "2.0.0",
        targetGistId: existingGistId,
        isNonInteractive: true,
        isAgentMode: true
      };

      await provider.publish(shareContext);

      const cached = readGistCache(existingGistId);
      expect(cached).not.toBeNull();
      expect(cached?.data.id).toBe(existingGistId);
      expect(cached?.data.files["smcp.json"]?.content).toBe(gistFiles["smcp.json"].content);
    });

    it("does not write or corrupt cache when publish fails with an API error", async () => {
      const failingGistId = "e1b2c3d4e5f607182930a1b2c3d4e5f6";

      mockHandler = () => ({
        status: 401,
        data: { message: "Bad credentials" }
      });

      const provider = new GistShareProvider();
      const shareContext: ShareProviderContext = {
        manifest: { name: "failed-pack", version: "1.0.0" },
        bundledSkills: [],
        bundledPlugins: [],
        bundledAgents: [],
        redactedServers: {},
        selectedServers: [],
        selectedSkills: [],
        selectedPlugins: [],
        selectedAgents: [],
        gistFiles: { "smcp.json": { content: "{}" } },
        options: {},
        cleanPackName: "failed-pack",
        cleanPackDesc: "Failed pack",
        version: "1.0.0",
        targetGistId: failingGistId,
        isNonInteractive: true,
        isAgentMode: true
      };

      const result = await provider.publish(shareContext);
      expect(result).toBe(false);
      expect(readGistCache(failingGistId)).toBeNull();
    });

    it("pre-warms cache with all files marked as non-truncated", async () => {
      const complexGistId = "f1b2c3d4e5f607182930a1b2c3d4e5f6";
      const complexUrl = `https://gist.github.com/octocat/${complexGistId}`;

      mockHandler = () => ({
        status: 201,
        data: { id: complexGistId, html_url: complexUrl }
      });

      const gistFiles = {
        "smcp.json": { content: JSON.stringify({ name: "multi-file-pack", version: "1.0.0" }) },
        "skills_helper_SKILL.md": { content: "# Helper" },
        "agents_reviewer.md": { content: "Reviewer agent prompt" },
        "plugins_my-plugin_index.ts": { content: "console.log('plugin');" }
      };

      const provider = new GistShareProvider();
      await provider.publish({
        manifest: { name: "multi-file-pack", version: "1.0.0" },
        bundledSkills: [],
        bundledPlugins: [],
        bundledAgents: [],
        redactedServers: {},
        selectedServers: [],
        selectedSkills: [],
        selectedPlugins: [],
        selectedAgents: [],
        gistFiles,
        options: { isPublic: true },
        cleanPackName: "multi-file-pack",
        cleanPackDesc: "Multi-file pack",
        version: "1.0.0",
        isNonInteractive: true,
        isAgentMode: true
      });

      const cached = readGistCache(complexGistId);
      expect(cached).not.toBeNull();
      for (const [filename, fileObj] of Object.entries(gistFiles)) {
        expect(cached?.data.files[filename]).toBeDefined();
        expect(cached?.data.files[filename]?.content).toBe(fileObj.content);
        expect(cached?.data.files[filename]?.truncated).toBe(false);
      }
    });
  });

  describe("Commander CLI integration & options permutations", () => {
    it("respects --no-cache when invoked through Commander CLI parser", async () => {
      const gistId = "c0112345678901234567890123456789";
      const gistUrl = `https://gist.github.com/octocat/${gistId}`;

      // 1. Seed cache with v1.0.0
      writeGistCache(gistId, {
        id: gistId,
        html_url: gistUrl,
        description: "[smcp] cli-pack v1.0.0",
        files: {
          "smcp.json": {
            filename: "smcp.json",
            truncated: false,
            content: JSON.stringify({ name: "cli-pack", version: "1.0.0" })
          }
        }
      });

      mockHandler = () => ({
        status: 200,
        data: {
          id: gistId,
          html_url: gistUrl,
          description: "[smcp] cli-pack v2.0.0",
          files: {
            "smcp.json": {
              filename: "smcp.json",
              truncated: false,
              content: JSON.stringify({ name: "cli-pack", version: "2.0.0" })
            }
          }
        }
      });

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        // Run without --no-cache: should use warm cache
        const prog1 = createProgram({ extensionsLoaded: true });
        await prog1.parseAsync(["node", "smcp", "inspect", gistUrl, "--json"]);
        expect(requestCount).toBe(0);
        const lastLog1 = logs[logs.length - 1];
        const parsed1 = JSON.parse(lastLog1);
        expect(parsed1.manifest.version).toBe("1.0.0");

        // Run with --no-cache: should bypass cache and fetch from network
        const prog2 = createProgram({ extensionsLoaded: true });
        await prog2.parseAsync(["node", "smcp", "inspect", gistUrl, "--no-cache", "--json"]);
        expect(requestCount).toBe(1);
        const lastLog2 = logs[logs.length - 1];
        const parsed2 = JSON.parse(lastLog2);
        expect(parsed2.manifest.version).toBe("2.0.0");
      } finally {
        console.log = originalLog;
      }
    });

    it("handles boundary combinations of cache/noCache options correctly", async () => {
      const gistId = "0f712345678901234567890123456789";
      const gistUrl = `https://gist.github.com/octocat/${gistId}`;

      writeGistCache(gistId, {
        id: gistId,
        html_url: gistUrl,
        files: {
          "smcp.json": {
            filename: "smcp.json",
            truncated: false,
            content: JSON.stringify({ name: "boundary-pack", version: "1.0.0" })
          }
        }
      });

      mockHandler = () => ({
        status: 200,
        data: {
          id: gistId,
          html_url: gistUrl,
          files: {
            "smcp.json": {
              filename: "smcp.json",
              truncated: false,
              content: JSON.stringify({ name: "boundary-pack", version: "9.9.9" })
            }
          }
        }
      });

      // cache: true -> uses cache (0 requests)
      const res1 = await inspectCommand(gistUrl, { json: true, cache: true });
      expect(res1?.version).toBe("1.0.0");
      expect(requestCount).toBe(0);

      // noCache: false -> uses cache (0 requests)
      const res2 = await inspectCommand(gistUrl, { json: true, noCache: false });
      expect(res2?.version).toBe("1.0.0");
      expect(requestCount).toBe(0);

      // cache: false -> bypasses cache (1 request)
      const res3 = await inspectCommand(gistUrl, { json: true, cache: false });
      expect(res3?.version).toBe("9.9.9");
      expect(requestCount).toBe(1);

      // noCache: true -> bypasses cache (2 requests)
      const res4 = await inspectCommand(gistUrl, { json: true, noCache: true });
      expect(res4?.version).toBe("9.9.9");
      expect(requestCount).toBe(2);

      // empty options / undefined -> uses cache (still 2 requests)
      const res5 = await inspectCommand(gistUrl, { json: true });
      expect(res5?.version).toBe("9.9.9"); // Note: cache was updated to 9.9.9 during res4!
      expect(requestCount).toBe(2);
    });
  });

  describe("checkPackUpdateStatus edge cases & failure recovery", () => {
    it("bypasses cache even if cache entry timestamp is brand new (0ms) or in the future", async () => {
      const gistId = "f0070000001111111111222222222233";
      const gistUrl = `https://gist.github.com/octocat/${gistId}`;

      // Seed cache with future timestamp (simulating clock drift)
      const futureEntry: GistResponse = {
        id: gistId,
        html_url: gistUrl,
        files: {
          "smcp.json": {
            filename: "smcp.json",
            truncated: false,
            content: JSON.stringify({ name: "future-pack", version: "1.0.0" })
          }
        }
      };
      writeGistCache(gistId, futureEntry);
      // Manually set cachedAt to 1 hour in the future
      const cacheFile = path.join(testDir, "cache", "gists", `${gistId}.json`);
      const fileData = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      fileData.cachedAt = Date.now() + 3600000;
      fs.writeFileSync(cacheFile, JSON.stringify(fileData));

      mockHandler = () => ({
        status: 200,
        data: {
          id: gistId,
          html_url: gistUrl,
          files: {
            "smcp.json": {
              filename: "smcp.json",
              truncated: false,
              content: JSON.stringify({ name: "future-pack", version: "2.1.0" })
            }
          }
        }
      });

      const record: InstalledPackRecord = {
        name: "future-pack",
        source: gistUrl,
        version: "1.0.0",
        targetAgents: ["opencode"],
        installedMcp: [],
        installedSkills: [],
        installedPlugins: [],
        installedAt: new Date().toISOString()
      };

      const check = await checkPackUpdateStatus(record);
      expect(requestCount).toBe(1);
      expect(check.status).toBe("outdated");
      expect(check.latestVersion).toBe("2.1.0");

      // Verify that after checkPackUpdateStatus, disk cache was refreshed with v2.1.0
      const updatedCache = readGistCache(gistId);
      expect(updatedCache).not.toBeNull();
      const parsedManifest = JSON.parse(updatedCache?.data.files["smcp.json"]?.content || "{}");
      expect(parsedManifest.version).toBe("2.1.0");
    });

    it("handles remote 404 cleanly by setting status: deleted without crashing", async () => {
      const gistId = "de000000001111111111222222222233";
      const gistUrl = `https://gist.github.com/octocat/${gistId}`;

      mockHandler = () => ({
        status: 404,
        data: { message: "Not Found" }
      });

      const record: InstalledPackRecord = {
        name: "deleted-pack",
        source: gistUrl,
        version: "1.0.0",
        targetAgents: ["opencode"],
        installedMcp: [],
        installedSkills: [],
        installedPlugins: [],
        installedAt: new Date().toISOString()
      };

      const check = await checkPackUpdateStatus(record);
      expect(requestCount).toBe(1);
      expect(check.status).toBe("deleted");
    });

    it("handles remote 500 error cleanly by setting status: error without crashing", async () => {
      const gistId = "ee000000001111111111222222222233";
      const gistUrl = `https://gist.github.com/octocat/${gistId}`;

      mockHandler = () => ({
        status: 500,
        data: { message: "Internal Server Error" }
      });

      const record: InstalledPackRecord = {
        name: "error-pack",
        source: gistUrl,
        version: "1.0.0",
        targetAgents: ["opencode"],
        installedMcp: [],
        installedSkills: [],
        installedPlugins: [],
        installedAt: new Date().toISOString()
      };

      const check = await checkPackUpdateStatus(record);
      expect(requestCount).toBe(1);
      expect(check.status).toBe("error");
      expect(check.error).toBeDefined();
    });

    it("outdatedCommand --json detects updates for installed packs bypassing fresh cache", async () => {
      const gistId = "000da7ed001111111111222222222233";
      const gistUrl = `https://gist.github.com/octocat/${gistId}`;

      // Record installed pack v1.0.0
      const record: InstalledPackRecord = {
        name: "outdated-pack",
        source: gistUrl,
        version: "1.0.0",
        targetAgents: ["opencode"],
        installedMcp: [],
        installedSkills: [],
        installedPlugins: [],
        installedAt: new Date().toISOString()
      };
      recordInstalledPack(record);

      // Seed fresh cache with v1.0.0
      writeGistCache(gistId, {
        id: gistId,
        html_url: gistUrl,
        files: {
          "smcp.json": {
            filename: "smcp.json",
            truncated: false,
            content: JSON.stringify({ name: "outdated-pack", version: "1.0.0" })
          }
        }
      });

      // Mock returns v3.0.0
      mockHandler = () => ({
        status: 200,
        data: {
          id: gistId,
          html_url: gistUrl,
          files: {
            "smcp.json": {
              filename: "smcp.json",
              truncated: false,
              content: JSON.stringify({ name: "outdated-pack", version: "3.0.0" })
            }
          }
        }
      });

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));

      try {
        await outdatedCommand({ json: true });
        expect(requestCount).toBe(1);
        const lastLog = logs[logs.length - 1];
        const res = JSON.parse(lastLog);
        expect(res.success).toBe(true);
        expect(res.packs.length).toBe(1);
        expect(res.packs[0].name).toBe("outdated-pack");
        expect(res.packs[0].status).toBe("outdated");
        expect(res.packs[0].installedVersion).toBe("1.0.0");
        expect(res.packs[0].latestVersion).toBe("3.0.0");
      } finally {
        console.log = origLog;
      }
    });

    it("inspect with --no-cache preserves existing cache if network fetch fails", async () => {
      const gistId = "fa110000001111111111222222222233";
      const gistUrl = `https://gist.github.com/octocat/${gistId}`;

      // Seed cache with v1.0.0
      const initialEntry: GistResponse = {
        id: gistId,
        html_url: gistUrl,
        files: {
          "smcp.json": {
            filename: "smcp.json",
            truncated: false,
            content: JSON.stringify({ name: "failnet-pack", version: "1.0.0" })
          }
        }
      };
      writeGistCache(gistId, initialEntry);

      // Network returns 500
      mockHandler = () => ({
        status: 500,
        data: { message: "GitHub API down" }
      });

      const errors: string[] = [];
      const origErr = console.error;
      console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));

      try {
        const res = await inspectCommand(gistUrl, { json: true, noCache: true });
        expect(res).toBeNull();
        expect(errors.length).toBeGreaterThan(0);
        const errJson = JSON.parse(errors[errors.length - 1]);
        expect(errJson.error).toContain("GitHub service unavailable");

        // Old cache must NOT be corrupted or deleted
        const stillCached = readGistCache(gistId);
        expect(stillCached).not.toBeNull();
        expect(stillCached?.data.files["smcp.json"]?.content).toBe(
          initialEntry.files["smcp.json"].content
        );
      } finally {
        console.error = origErr;
      }
    });
  });
});
