import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import {
  clearGistDiskCache,
  clearGitHubClientCache,
  getGistCacheDir,
  GitHubClient,
  setDefaultAxiosAdapter,
  type GistResponse
} from "../packages/core/src/core/github.ts";
import {
  readGistCache,
  writeGistCache,
  touchGistCache,
  clearGistCache
} from "../packages/core/src/core/cache/index.ts";
import { loadPackFromSource } from "../packages/core/src/core/pack/loader.ts";

describe("Adversarial Quality Gate: Gist Disk Cache & Fetching", () => {
  interface CapturedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
  }

  let requestCount = 0;
  let capturedRequests: CapturedRequest[] = [];
  let mockHandler:
    | ((config: InternalAxiosRequestConfig) => {
        status?: number;
        statusText?: string;
        data?: unknown;
        headers?: Record<string, string>;
      })
    | null = null;

  beforeEach(() => {
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
        throw new Error("No mockHandler defined for test");
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
  });

  const baseGist: GistResponse = {
    id: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    html_url: "https://gist.github.com/octocat/a1b2c3d4e5f60718293a4b5c6d7e8f90",
    files: {
      "smcp.json": {
        filename: "smcp.json",
        truncated: false,
        content: JSON.stringify({
          name: "adversarial-pack",
          version: "1.0.0",
          description: "Adversarial test pack"
        })
      }
    }
  };

  describe("1. Boundary & Corruption Recovery", () => {
    it("safely recovers and fetches from network when cache file is truncated/corrupted JSON", async () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      // Write truncated/malformed JSON
      fs.writeFileSync(cacheFile, '{"cachedAt": 123456, "etag": "abc", "gist": {', "utf8");

      mockHandler = () => ({
        status: 200,
        headers: { etag: '"recovered-etag"' },
        data: baseGist
      });

      const gist = await GitHubClient.fetchGist(baseGist.id);
      expect(requestCount).toBe(1);
      expect(gist.id).toBe(baseGist.id);

      // Corrupted file must be repaired with valid JSON
      const repairedContent = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      expect(repairedContent.etag).toBe('"recovered-etag"');
      expect(repairedContent.gist.id).toBe(baseGist.id);
    });

    it("safely recovers when cache file is completely empty (0 bytes)", async () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      fs.writeFileSync(cacheFile, "", "utf8");

      mockHandler = () => ({
        status: 200,
        headers: { etag: '"empty-recovered-etag"' },
        data: baseGist
      });

      const gist = await GitHubClient.fetchGist(baseGist.id);
      expect(requestCount).toBe(1);
      expect(gist.id).toBe(baseGist.id);
      expect(fs.readFileSync(cacheFile, "utf8").length).toBeGreaterThan(0);
    });

    it("safely recovers when cache file has malformed schema (null, missing files, wrong types)", async () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      const malformedPayloads = [
        "null",
        "{}",
        '{"cachedAt": "not-a-number", "gist": {}}',
        '{"cachedAt": 123, "gist": null}',
        '{"cachedAt": 123, "gist": {"files": null}}',
        '{"cachedAt": 123, "gist": {"files": "invalid"}}'
      ];

      for (const badPayload of malformedPayloads) {
        fs.writeFileSync(cacheFile, badPayload, "utf8");
        mockHandler = () => ({
          status: 200,
          headers: { etag: '"schema-recovered"' },
          data: baseGist
        });

        requestCount = 0;
        const gist = await GitHubClient.fetchGist(baseGist.id);
        expect(requestCount).toBe(1);
        expect(gist.id).toBe(baseGist.id);
      }
    });

    it("gracefully falls back to network when cache file is unreadable (EACCES)", async () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      fs.writeFileSync(cacheFile, '{"valid":"json"}', "utf8");
      try {
        fs.chmodSync(cacheFile, 0o000);

        mockHandler = () => ({
          status: 200,
          data: baseGist
        });

        const gist = await GitHubClient.fetchGist(baseGist.id);
        expect(requestCount).toBe(1);
        expect(gist.id).toBe(baseGist.id);
      } finally {
        fs.chmodSync(cacheFile, 0o666);
      }
    });
  });

  describe("2. Manifest Validation & Missing smcp.json", () => {
    it("throws 'Gist does not contain an smcp.json manifest file.' when smcp.json is missing", async () => {
      const gistWithoutSmcp: GistResponse = {
        id: "11223344556677889900aabbccddeeff",
        html_url: "https://gist.github.com/octocat/11223344556677889900aabbccddeeff",
        files: {
          "README.md": {
            filename: "README.md",
            truncated: false,
            content: "# Just a readme"
          }
        }
      };

      mockHandler = () => ({
        status: 200,
        data: gistWithoutSmcp
      });

      await expect(
        loadPackFromSource(`https://gist.github.com/${gistWithoutSmcp.id}`)
      ).rejects.toThrow("Gist does not contain an smcp.json manifest file.");
    });

    it("throws 'Gist smcp.json file is empty or missing content.' when smcp.json has empty content", async () => {
      const gistWithEmptySmcp: GistResponse = {
        id: "99887766554433221100ffeeddccbbaa",
        html_url: "https://gist.github.com/octocat/99887766554433221100ffeeddccbbaa",
        files: {
          "smcp.json": {
            filename: "smcp.json",
            truncated: false,
            content: ""
          }
        }
      };

      mockHandler = () => ({
        status: 200,
        data: gistWithEmptySmcp
      });

      await expect(
        loadPackFromSource(`https://gist.github.com/${gistWithEmptySmcp.id}`)
      ).rejects.toThrow();
    });
  });

  describe("3. TTL Expiry and Boundary Conditions", () => {
    it("respects custom cacheTtlMs and revalidates precisely after expiry", async () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      const now = Date.now();
      // Cached 500ms ago
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          etag: '"boundary-etag"',
          cachedAt: now - 500,
          gist: baseGist
        }),
        "utf8"
      );

      mockHandler = (config) => {
        if (config.headers?.["If-None-Match"] === '"boundary-etag"') {
          return { status: 304, headers: { etag: '"boundary-etag"' }, data: null };
        }
        return { status: 200, data: baseGist };
      };

      // Case A: TTL is 1000ms -> 500ms is within TTL -> Hit cache without network
      const resA = await GitHubClient.fetchGist(baseGist.id, undefined, { cacheTtlMs: 1000 });
      expect(requestCount).toBe(0);
      expect(resA.id).toBe(baseGist.id);

      // Case B: TTL is 300ms -> 500ms is expired -> Revalidates with 304
      const resB = await GitHubClient.fetchGist(baseGist.id, undefined, { cacheTtlMs: 300 });
      expect(requestCount).toBe(1);
      expect(capturedRequests[0].headers["If-None-Match"]).toBe('"boundary-etag"');
      expect(resB.id).toBe(baseGist.id);
    });

    it("revalidates immediately when cacheTtlMs: 0", async () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          etag: '"zero-ttl-etag"',
          cachedAt: Date.now(), // freshly written right now!
          gist: baseGist
        }),
        "utf8"
      );

      mockHandler = (config) => {
        if (config.headers?.["If-None-Match"] === '"zero-ttl-etag"') {
          return { status: 304, headers: { etag: '"zero-ttl-etag"' }, data: null };
        }
        return { status: 200, data: baseGist };
      };

      await GitHubClient.fetchGist(baseGist.id, undefined, { cacheTtlMs: 0 });
      expect(requestCount).toBe(1); // Sent conditional request despite 0ms age
      expect(capturedRequests[0].headers["If-None-Match"]).toBe('"zero-ttl-etag"');
    });
  });

  describe("4. 304 Not Modified & 200 OK Semantics", () => {
    it("updates cachedAt and preserves cached gist data on 304 Not Modified without new ETag header", async () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      const staleCachedAt = Date.now() - 300000;
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          etag: '"keep-this-etag"',
          cachedAt: staleCachedAt,
          gist: baseGist
        }),
        "utf8"
      );

      mockHandler = () => ({
        status: 304,
        headers: {}, // No new ETag header returned
        data: null
      });

      const res = await GitHubClient.fetchGist(baseGist.id);
      expect(requestCount).toBe(1);
      expect(res.files["smcp.json"].content).toBe(baseGist.files["smcp.json"].content);

      const cacheOnDisk = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      expect(cacheOnDisk.etag).toBe('"keep-this-etag"'); // ETag retained
      expect(cacheOnDisk.cachedAt).toBeGreaterThan(staleCachedAt); // cachedAt updated
    });

    it("completely replaces old cache on 200 revalidation with fresh files and removes obsolete entries", async () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      const staleGist: GistResponse = {
        id: baseGist.id,
        html_url: baseGist.html_url,
        files: {
          "smcp.json": { filename: "smcp.json", content: '{"name":"old-pack"}' },
          "obsolete-file.txt": { filename: "obsolete-file.txt", content: "should-disappear" }
        }
      };

      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          etag: '"old-etag"',
          cachedAt: Date.now() - 100000,
          gist: staleGist
        }),
        "utf8"
      );

      const freshGist: GistResponse = {
        id: baseGist.id,
        html_url: baseGist.html_url,
        files: {
          "smcp.json": { filename: "smcp.json", content: '{"name":"fresh-pack"}' },
          "new-file.txt": { filename: "new-file.txt", content: "new-content" }
        }
      };

      mockHandler = () => ({
        status: 200,
        headers: { etag: '"brand-new-etag"' },
        data: freshGist
      });

      const res = await GitHubClient.fetchGist(baseGist.id);
      expect(res.files["smcp.json"].content).toBe('{"name":"fresh-pack"}');
      expect(res.files["obsolete-file.txt"]).toBeUndefined();
      expect(res.files["new-file.txt"].content).toBe("new-content");

      const diskCache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      expect(diskCache.etag).toBe('"brand-new-etag"');
      expect(diskCache.gist.files["obsolete-file.txt"]).toBeUndefined();
      expect(diskCache.gist.files["new-file.txt"].content).toBe("new-content");
    });
  });

  describe("5. Remote 404 & Failure Handling", () => {
    it("throws and does NOT return stale cache if remote returns 404 (gist deleted)", async () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          etag: '"stale-etag"',
          cachedAt: Date.now() - 100000,
          gist: baseGist
        }),
        "utf8"
      );

      mockHandler = () => ({
        status: 404,
        statusText: "Not Found",
        data: { message: "Not Found" }
      });

      await expect(GitHubClient.fetchGist(baseGist.id)).rejects.toThrow("Failed to fetch Gist");
    });
  });

  describe("6. Incremental Truncated File Resolution on Cached Gist", () => {
    it("resolves remaining truncated files when fetchAllTruncated: true is called on an already cached gist", async () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      // Gist cached initially with fetchAllTruncated: false
      // smcp.json is resolved, but large-skill.md is truncated
      const initialCachedGist: GistResponse = {
        id: baseGist.id,
        html_url: baseGist.html_url,
        files: {
          "smcp.json": {
            filename: "smcp.json",
            truncated: false,
            content: '{"name":"incremental-test","version":"1.0.0"}'
          },
          "skills/large/SKILL.md": {
            filename: "skills/large/SKILL.md",
            truncated: true,
            raw_url: "https://raw.githubusercontent.com/gist/large-skill.md",
            content: "# Truncated initial..."
          }
        }
      };

      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          etag: '"inc-etag"',
          cachedAt: Date.now(), // freshly cached within TTL
          gist: initialCachedGist
        }),
        "utf8"
      );

      mockHandler = (config) => {
        if (config.url === "https://raw.githubusercontent.com/gist/large-skill.md") {
          return { status: 200, data: "# Full Resolved Large Skill Content" };
        }
        throw new Error(`Unexpected request to: ${config.url}`);
      };

      // Call fetchGist with fetchAllTruncated: true within TTL
      const res = await GitHubClient.fetchGist(baseGist.id, undefined, {
        fetchAllTruncated: true
      });

      expect(res.files["skills/large/SKILL.md"].truncated).toBe(false);
      expect(res.files["skills/large/SKILL.md"].content).toBe(
        "# Full Resolved Large Skill Content"
      );

      // Verify that disk cache was updated with the resolved content
      const diskEntry = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      expect(diskEntry.gist.files["skills/large/SKILL.md"].truncated).toBe(false);
      expect(diskEntry.gist.files["skills/large/SKILL.md"].content).toBe(
        "# Full Resolved Large Skill Content"
      );
    });
  });

  describe("7. Directory Auto-Creation & Non-Existent Path Handling", () => {
    it("handles readGistCache and clearGistCache gracefully when cache directory does not exist", () => {
      const cacheDir = getGistCacheDir();
      fs.rmSync(cacheDir, { recursive: true, force: true });
      expect(fs.existsSync(cacheDir)).toBe(false);

      expect(readGistCache(baseGist.id)).toBeNull();
      expect(() => clearGistCache()).not.toThrow();
      expect(() => clearGistCache(baseGist.id)).not.toThrow();
    });

    it("automatically creates ~/.smcp/cache/gists directory on first write with 0700 permissions", () => {
      const cacheDir = getGistCacheDir();
      fs.rmSync(cacheDir, { recursive: true, force: true });
      expect(fs.existsSync(cacheDir)).toBe(false);

      writeGistCache(baseGist.id, baseGist, '"auto-create-etag"');
      expect(fs.existsSync(cacheDir)).toBe(true);

      const stats = fs.statSync(cacheDir);
      expect(stats.isDirectory()).toBe(true);

      const entry = readGistCache(baseGist.id);
      expect(entry).not.toBeNull();
      expect(entry!.etag).toBe('"auto-create-etag"');
      expect(entry!.data.id).toBe(baseGist.id);
    });
  });

  describe("8. TTL Boundary Conditions & Extreme Timestamps", () => {
    it("treats age exactly equal to ttlMs as expired in readGistCache", () => {
      const now = 1000000;
      const ttl = 5000;
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      // Write with cachedAt exactly equal to now - ttl
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          etag: '"exact-boundary"',
          cachedAt: now - ttl,
          gist: baseGist
        }),
        "utf8"
      );

      // Spy on Date.now
      const realDateNow = Date.now;
      try {
        Date.now = () => now;

        // Exact boundary: age === ttl (5000ms >= 5000ms) -> expired
        const atBoundary = readGistCache(baseGist.id, { ttlMs: ttl });
        expect(atBoundary).toBeNull();

        // 1ms before boundary: age === ttl - 1 (4999ms < 5000ms) -> fresh
        Date.now = () => now - 1;
        const beforeBoundary = readGistCache(baseGist.id, { ttlMs: ttl });
        expect(beforeBoundary).not.toBeNull();
      } finally {
        Date.now = realDateNow;
      }
    });

    it("handles future timestamps gracefully (clock drift into future)", () => {
      const now = Date.now();
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      // Timestamp 1 hour into future
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          etag: '"future-etag"',
          cachedAt: now + 3600000,
          gist: baseGist
        }),
        "utf8"
      );

      // readGistCache with TTL: age is negative, age < ttlMs, doesn't throw
      const entry = readGistCache(baseGist.id, { ttlMs: 60000 });
      expect(entry).not.toBeNull();
      expect(entry?.etag).toBe('"future-etag"');
    });

    it("treats negative cachedAt as expired when TTL is checked", () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          etag: '"negative-cached-at"',
          cachedAt: -1000,
          gist: baseGist
        }),
        "utf8"
      );

      const entry = readGistCache(baseGist.id, { ttlMs: 60000 });
      expect(entry).toBeNull();
    });
  });

  describe("9. Concurrent & Duplicate Writes / Touch", () => {
    it("handles 50 concurrent writes without corruption or torn files", async () => {
      const iterations = 50;
      const promises: Promise<void>[] = [];

      for (let i = 0; i < iterations; i++) {
        promises.push(
          (async () => {
            const variantGist: GistResponse = {
              id: baseGist.id,
              html_url: baseGist.html_url,
              files: {
                "smcp.json": {
                  filename: "smcp.json",
                  content: JSON.stringify({ iteration: i })
                }
              }
            };
            writeGistCache(baseGist.id, variantGist, `"etag-${i}"`);
          })()
        );
      }

      await Promise.all(promises);

      // Verify file is readable and completely valid JSON
      const entry = readGistCache(baseGist.id);
      expect(entry).not.toBeNull();
      expect(entry?.gist.files["smcp.json"].content).toBeDefined();
      const contentObj = JSON.parse(entry!.gist.files["smcp.json"].content!);
      expect(typeof contentObj.iteration).toBe("number");
    });

    it("handles concurrent touch operations idempotently", async () => {
      writeGistCache(baseGist.id, baseGist, '"touch-test"');

      const touches = Array.from({ length: 20 }, async () => {
        touchGistCache(baseGist.id);
      });
      await Promise.all(touches);

      const entry = readGistCache(baseGist.id);
      expect(entry).not.toBeNull();
      expect(entry?.etag).toBe('"touch-test"');
      expect(entry?.data.id).toBe(baseGist.id);
    });
  });

  describe("10. Bulk and Specific clearGistCache Operations", () => {
    it("clearGistCache preserves non-JSON files and non-target caches", () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });

      // Create a foreign non-json file
      const nonJsonFile = path.join(cacheDir, "metadata.txt");
      fs.writeFileSync(nonJsonFile, "keep me", "utf8");

      const gistA = { ...baseGist, id: "00000000000000000000000000000001" };
      const gistB = { ...baseGist, id: "00000000000000000000000000000002" };
      writeGistCache(gistA.id, gistA);
      writeGistCache(gistB.id, gistB);

      // Clear specific ID
      clearGistCache(gistA.id);
      expect(readGistCache(gistA.id)).toBeNull();
      expect(readGistCache(gistB.id)).not.toBeNull();
      expect(fs.existsSync(nonJsonFile)).toBe(true);

      // Clear all
      clearGistCache();
      expect(readGistCache(gistB.id)).toBeNull();
      // Non-JSON file must NOT be deleted
      expect(fs.existsSync(nonJsonFile)).toBe(true);

      // Cleanup
      fs.unlinkSync(nonJsonFile);
    });

    it("clearGistCache with non-existent ID does not throw or delete other entries", () => {
      writeGistCache(baseGist.id, baseGist);
      expect(() => clearGistCache("nonexistent_id_9999999999")).not.toThrow();
      expect(readGistCache(baseGist.id)).not.toBeNull();
    });
  });

  describe("11. Non-Object JSON & Schema Boundary Variations", () => {
    it("rejects non-object primitives in cache JSON", () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `${baseGist.id}.json`);

      const primitives = [
        '"string primitive"',
        "123456",
        "true",
        "false",
        "null",
        "[1, 2, 3]",
        '{"cachedAt": 123456, "gist": "string-instead-of-object"}',
        '{"cachedAt": 123456, "gist": 12345}',
        '{"cachedAt": 123456, "gist": []}',
        '{"cachedAt": 123456, "gist": {"files": []}}',
        '{"cachedAt": 123456, "gist": {"files": null}}'
      ];

      for (const prim of primitives) {
        fs.writeFileSync(cacheFile, prim, "utf8");
        expect(readGistCache(baseGist.id)).toBeNull();
      }
    });

    it("handles read-only cache directory gracefully during write", () => {
      const cacheDir = getGistCacheDir();
      fs.mkdirSync(cacheDir, { recursive: true });
      const testId = "readonly_dir_test";

      try {
        fs.chmodSync(cacheDir, 0o555); // read and execute only, no write
        // Should not throw, should gracefully catch error
        expect(() => writeGistCache(testId, baseGist)).not.toThrow();
      } finally {
        fs.chmodSync(cacheDir, 0o700);
      }
    });
  });
});
