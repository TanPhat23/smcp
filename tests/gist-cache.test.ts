import fs from "node:fs";
import path from "node:path";
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
  clearGistCache,
  readGistCache,
  writeGistCache,
  touchGistCache,
  type CacheEntry,
  type CacheOptions
} from "../packages/core/src/core/cache/index.ts";
import { loadPackFromSource } from "../packages/core/src/core/pack/loader.ts";
import { GistPackLoader } from "../packages/core/src/core/pack/registry.ts";

describe("Gist Disk Cache & Selective Truncated Fetching", () => {
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

  const baseGistResponse: GistResponse = {
    id: "abc12345",
    html_url: "https://gist.github.com/octocat/abc12345",
    files: {
      "smcp.json": {
        filename: "smcp.json",
        truncated: false,
        content: '{"name":"cached-pack","version":"1.0.0"}'
      }
    }
  };

  it("returns cached gist when within TTL without network request", async () => {
    mockHandler = () => ({
      status: 200,
      headers: { etag: '"initial-etag-1"' },
      data: baseGistResponse
    });

    const first = await GitHubClient.fetchGist("abc12345");
    expect(requestCount).toBe(1);
    expect(first.id).toBe("abc12345");

    // Cache file should exist on disk
    const cacheFile = path.join(getGistCacheDir(), "abc12345.json");
    expect(fs.existsSync(cacheFile)).toBe(true);

    // Second call within TTL (default 60s)
    const second = await GitHubClient.fetchGist("abc12345");
    expect(requestCount).toBe(1); // No new network call
    expect(second.files["smcp.json"].content).toBe('{"name":"cached-pack","version":"1.0.0"}');
  });

  it("returns cached gist on 304 Not Modified when TTL expired", async () => {
    const cacheDir = getGistCacheDir();
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, "abc12345.json");
    const staleTime = Date.now() - 120000; // 2 minutes ago (> 60s TTL)
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        etag: '"etag-304-test"',
        cachedAt: staleTime,
        gist: baseGistResponse
      }),
      "utf8"
    );

    mockHandler = (config) => {
      // Expect conditional header If-None-Match
      if (config.headers?.["If-None-Match"] === '"etag-304-test"') {
        return {
          status: 304,
          statusText: "Not Modified",
          headers: { etag: '"etag-304-test"' },
          data: null
        };
      }
      return { status: 200, data: baseGistResponse };
    };

    const res = await GitHubClient.fetchGist("abc12345");
    expect(requestCount).toBe(1);
    expect(capturedRequests[0].headers["If-None-Match"]).toBe('"etag-304-test"');
    expect(res.files["smcp.json"].content).toBe('{"name":"cached-pack","version":"1.0.0"}');

    // cachedAt should have been refreshed to current time
    const updatedCache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    expect(updatedCache.cachedAt).toBeGreaterThan(staleTime);
  });

  it("updates cache with fresh 200 response when remote gist was modified after expired TTL", async () => {
    const cacheDir = getGistCacheDir();
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, "abc12345.json");
    const staleTime = Date.now() - 120000;
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        etag: '"old-etag"',
        cachedAt: staleTime,
        gist: baseGistResponse
      }),
      "utf8"
    );

    const updatedGistResponse: GistResponse = {
      id: "abc12345",
      html_url: "https://gist.github.com/octocat/abc12345",
      files: {
        "smcp.json": {
          filename: "smcp.json",
          truncated: false,
          content: '{"name":"updated-pack","version":"2.0.0"}'
        }
      }
    };

    mockHandler = () => ({
      status: 200,
      headers: { etag: '"new-etag-200"' },
      data: updatedGistResponse
    });

    const res = await GitHubClient.fetchGist("abc12345");
    expect(requestCount).toBe(1);
    expect(capturedRequests[0].headers["If-None-Match"]).toBe('"old-etag"');
    expect(res.files["smcp.json"].content).toBe('{"name":"updated-pack","version":"2.0.0"}');

    const updatedCache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    expect(updatedCache.etag).toBe('"new-etag-200"');
    expect(updatedCache.gist.files["smcp.json"].content).toBe(
      '{"name":"updated-pack","version":"2.0.0"}'
    );
  });

  it("bypasses cache when noCache: true is passed", async () => {
    const cacheDir = getGistCacheDir();
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Cache has old content and is within TTL
    const cacheFile = path.join(cacheDir, "abc12345.json");
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        etag: '"etag-cached"',
        cachedAt: Date.now(), // fresh!
        gist: baseGistResponse
      }),
      "utf8"
    );

    const freshGist: GistResponse = {
      id: "abc12345",
      html_url: "https://gist.github.com/octocat/abc12345",
      files: {
        "smcp.json": {
          filename: "smcp.json",
          truncated: false,
          content: '{"name":"bypassed-fresh-pack","version":"3.0.0"}'
        }
      }
    };

    mockHandler = () => ({
      status: 200,
      headers: { etag: '"fresh-etag"' },
      data: freshGist
    });

    const res = await GitHubClient.fetchGist("abc12345", undefined, { noCache: true });
    expect(requestCount).toBe(1); // Network call made despite fresh cache
    expect(capturedRequests[0].headers["If-None-Match"]).toBeUndefined(); // Cache bypass does not send If-None-Match
    expect(res.files["smcp.json"].content).toBe('{"name":"bypassed-fresh-pack","version":"3.0.0"}');
  });

  it("fetches only smcp.json when truncated, and ignores other truncated files by default", async () => {
    const gistWithTruncatedFiles: GistResponse = {
      id: "a1b2c3d4e5f60001",
      html_url: "https://gist.github.com/octocat/a1b2c3d4e5f60001",
      files: {
        "smcp.json": {
          filename: "smcp.json",
          truncated: true,
          raw_url: "https://raw.githubusercontent.com/gist/smcp.json",
          content: '{"name":"partial'
        },
        "SKILL.md": {
          filename: "SKILL.md",
          truncated: true,
          raw_url: "https://raw.githubusercontent.com/gist/SKILL.md",
          content: "# Partial skill"
        },
        "PLUGIN.js": {
          filename: "PLUGIN.js",
          truncated: true,
          raw_url: "https://raw.githubusercontent.com/gist/PLUGIN.js",
          content: "// Partial plugin"
        }
      }
    };

    mockHandler = (config) => {
      if (config.url === "https://raw.githubusercontent.com/gist/smcp.json") {
        return { status: 200, data: '{"name":"full-pack","version":"1.0.0"}' };
      }
      if (config.url === "https://raw.githubusercontent.com/gist/SKILL.md") {
        return { status: 200, data: "# Full skill documentation" };
      }
      if (config.url === "https://raw.githubusercontent.com/gist/PLUGIN.js") {
        return { status: 200, data: "console.log('full plugin');" };
      }
      return { status: 200, data: gistWithTruncatedFiles };
    };

    const res = await GitHubClient.fetchGist("a1b2c3d4e5f60001");

    // smcp.json MUST be resolved immediately
    expect(res.files["smcp.json"].truncated).toBe(false);
    expect(res.files["smcp.json"].content).toBe('{"name":"full-pack","version":"1.0.0"}');

    // Other truncated files MUST NOT be fetched
    expect(res.files["SKILL.md"].truncated).toBe(true);
    expect(res.files["SKILL.md"].content).toBe("# Partial skill");
    expect(res.files["PLUGIN.js"].truncated).toBe(true);
    expect(res.files["PLUGIN.js"].content).toBe("// Partial plugin");

    // Verify raw requests: only the gist metadata + raw smcp.json were requested
    const requestedUrls = capturedRequests.map((r) => r.url);
    expect(requestedUrls).toContain("https://raw.githubusercontent.com/gist/smcp.json");
    expect(requestedUrls).not.toContain("https://raw.githubusercontent.com/gist/SKILL.md");
    expect(requestedUrls).not.toContain("https://raw.githubusercontent.com/gist/PLUGIN.js");
  });

  it("fetches all truncated files when fetchAllTruncated: true", async () => {
    const gistWithTruncatedFiles: GistResponse = {
      id: "a1b2c3d4e5f60002",
      html_url: "https://gist.github.com/octocat/a1b2c3d4e5f60002",
      files: {
        "smcp.json": {
          filename: "smcp.json",
          truncated: true,
          raw_url: "https://raw.githubusercontent.com/gist/smcp.json",
          content: '{"name":"partial'
        },
        "SKILL.md": {
          filename: "SKILL.md",
          truncated: true,
          raw_url: "https://raw.githubusercontent.com/gist/SKILL.md",
          content: "# Partial skill"
        }
      }
    };

    mockHandler = (config) => {
      if (config.url === "https://raw.githubusercontent.com/gist/smcp.json") {
        return { status: 200, data: '{"name":"full-pack","version":"1.0.0"}' };
      }
      if (config.url === "https://raw.githubusercontent.com/gist/SKILL.md") {
        return { status: 200, data: "# Full skill documentation" };
      }
      return { status: 200, data: gistWithTruncatedFiles };
    };

    const res = await GitHubClient.fetchGist("a1b2c3d4e5f60002", undefined, { fetchAllTruncated: true });

    expect(res.files["smcp.json"].truncated).toBe(false);
    expect(res.files["smcp.json"].content).toBe('{"name":"full-pack","version":"1.0.0"}');

    expect(res.files["SKILL.md"].truncated).toBe(false);
    expect(res.files["SKILL.md"].content).toBe("# Full skill documentation");
  });

  it("does not fetch smcp.json if it already has content and is not truncated", async () => {
    const nonTruncatedGist: GistResponse = {
      id: "a1b2c3d4e5f60003",
      html_url: "https://gist.github.com/octocat/a1b2c3d4e5f60003",
      files: {
        "smcp.json": {
          filename: "smcp.json",
          truncated: false,
          raw_url: "https://raw.githubusercontent.com/gist/smcp.json",
          content: '{"name":"already-full","version":"1.0.0"}'
        }
      }
    };

    mockHandler = (config) => {
      if (config.url?.includes("raw.githubusercontent.com")) {
        throw new Error("Raw URL should not be fetched!");
      }
      return { status: 200, data: nonTruncatedGist };
    };

    const res = await GitHubClient.fetchGist("a1b2c3d4e5f60003");
    expect(requestCount).toBe(1); // Only the Gist metadata call, no raw_url call
    expect(res.files["smcp.json"].content).toBe('{"name":"already-full","version":"1.0.0"}');
  });

  it("propagates noCache and fetchAllTruncated through loadPackFromSource and GistPackLoader", async () => {
    const gistWithTruncatedFiles: GistResponse = {
      id: "a1b2c3d4e5f60004",
      html_url: "https://gist.github.com/octocat/a1b2c3d4e5f60004",
      files: {
        "smcp.json": {
          filename: "smcp.json",
          truncated: false,
          content: '{"name":"loader-pack","version":"1.0.0"}'
        },
        "skills/demo/SKILL.md": {
          filename: "skills/demo/SKILL.md",
          truncated: true,
          raw_url: "https://raw.githubusercontent.com/gist/SKILL.md",
          content: "# Partial skill"
        }
      }
    };

    mockHandler = (config) => {
      if (config.url === "https://raw.githubusercontent.com/gist/SKILL.md") {
        return { status: 200, data: "# Full loaded skill" };
      }
      return { status: 200, data: gistWithTruncatedFiles };
    };

    // 1. Without fetchAllTruncated: skills/demo/SKILL.md remains partial
    const pack1 = await loadPackFromSource("https://gist.github.com/a1b2c3d4e5f60004");
    expect(pack1.rawFiles["skills/demo/SKILL.md"]).toBe("# Partial skill");

    // 2. With fetchAllTruncated: true and noCache: true: skills/demo/SKILL.md is fully resolved
    const pack2 = await loadPackFromSource("https://gist.github.com/a1b2c3d4e5f60004", {
      noCache: true,
      fetchAllTruncated: true
    });
    expect(pack2.rawFiles["skills/demo/SKILL.md"]).toBe("# Full loaded skill");
  });
});

describe("Direct Cache Module API (packages/core/src/core/cache/)", () => {
  const sampleGist: GistResponse = {
    id: "direct12345",
    html_url: "https://gist.github.com/octocat/direct12345",
    files: {
      "smcp.json": {
        filename: "smcp.json",
        truncated: false,
        content: JSON.stringify({ name: "direct-pack", version: "1.0.0" })
      }
    }
  };

  beforeEach(() => {
    clearGistCache();
  });

  afterEach(() => {
    clearGistCache();
  });

  it("getGistCacheDir returns a path ending in cache/gists", () => {
    const dir = getGistCacheDir();
    expect(dir).toBeDefined();
    expect(dir.replace(/\\/g, "/")).toContain("cache/gists");
  });

  it("writes and reads cache entry with CacheEntry<T> contract", () => {
    writeGistCache("direct12345", sampleGist, '"etag-direct-1"');

    const entry = readGistCache("direct12345");
    expect(entry).not.toBeNull();
    expect(entry!.etag).toBe('"etag-direct-1"');
    expect(typeof entry!.cachedAt).toBe("number");
    expect(entry!.data.id).toBe("direct12345");
    expect(entry!.data.files["smcp.json"].content).toBe(sampleGist.files["smcp.json"].content);
  });

  it("readGistCache returns null when noCache: true", () => {
    writeGistCache("direct12345", sampleGist, '"etag-direct-2"');
    const entry = readGistCache("direct12345", { noCache: true });
    expect(entry).toBeNull();
  });

  it("readGistCache enforces ttlMs option correctly", async () => {
    writeGistCache("direct12345", sampleGist, '"etag-direct-3"');

    // Fresh within 10s TTL
    const fresh = readGistCache("direct12345", { ttlMs: 10000 });
    expect(fresh).not.toBeNull();

    // Expired with 0ms TTL
    const expired = readGistCache("direct12345", { ttlMs: 0 });
    expect(expired).toBeNull();
  });

  it("readGistCache safely returns null on corrupted cache JSON", () => {
    const cacheDir = getGistCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, "direct12345.json");
    fs.writeFileSync(cacheFile, "{ corrupted json !@#$", "utf8");

    const entry = readGistCache("direct12345");
    expect(entry).toBeNull();
  });

  it("touchGistCache refreshes cachedAt while preserving data and etag", async () => {
    writeGistCache("direct12345", sampleGist, '"etag-touch"');
    const first = readGistCache("direct12345");
    expect(first).not.toBeNull();
    const initialCachedAt = first!.cachedAt;

    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 20));

    touchGistCache("direct12345");
    const touched = readGistCache("direct12345");
    expect(touched).not.toBeNull();
    expect(touched!.cachedAt).toBeGreaterThan(initialCachedAt);
    expect(touched!.etag).toBe('"etag-touch"');
    expect(touched!.data.id).toBe("direct12345");
  });

  it("clearGistCache deletes a specific entry when id is passed and leaves others", () => {
    const secondGist: GistResponse = {
      id: "other99999",
      html_url: "https://gist.github.com/octocat/other99999",
      files: {
        "smcp.json": { filename: "smcp.json", content: "{}" }
      }
    };

    writeGistCache("direct12345", sampleGist);
    writeGistCache("other99999", secondGist);

    expect(readGistCache("direct12345")).not.toBeNull();
    expect(readGistCache("other99999")).not.toBeNull();

    clearGistCache("direct12345");

    expect(readGistCache("direct12345")).toBeNull();
    expect(readGistCache("other99999")).not.toBeNull();
  });

  it("clearGistCache deletes all entries when called without id", () => {
    writeGistCache("direct12345", sampleGist);
    writeGistCache("other99999", sampleGist);

    expect(readGistCache("direct12345")).not.toBeNull();
    expect(readGistCache("other99999")).not.toBeNull();

    clearGistCache();

    expect(readGistCache("direct12345")).toBeNull();
    expect(readGistCache("other99999")).toBeNull();
  });
});
