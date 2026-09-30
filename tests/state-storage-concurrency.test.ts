import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearAuthConfig,
  getAuthConfig,
  getSharesHistory,
  recordShare,
  registerStorageProvider,
  resetStorageProvider,
  saveAuthConfig,
  type StorageProvider
} from "../packages/core/src/core/state/index.ts";

describe("State Management & Storage Provider Concurrency Stress", () => {
  let tmpDir: string;
  let originalSmcpDir: string | undefined;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      "smcp-state-stress-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(tmpDir, { recursive: true });

    originalSmcpDir = process.env.SMCP_DIR;
    process.env.SMCP_DIR = tmpDir;
    resetStorageProvider();
  });

  afterEach(() => {
    resetStorageProvider();
    if (originalSmcpDir !== undefined) {
      process.env.SMCP_DIR = originalSmcpDir;
    } else {
      delete process.env.SMCP_DIR;
    }

    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles 30 concurrent recordShare calls without data corruption", async () => {
    const operations = Array.from({ length: 30 }, (_, i) => {
      return Promise.resolve().then(() => {
        recordShare({
          name: `concurrent-share-${i}`,
          version: "1.0.0",
          targetType: "gist",
          targetUrl: `https://gist.github.com/user/test-${i}`,
          gistId: `gist-id-${i}`,
          lastSharedAt: new Date().toISOString(),
          fingerprints: {
            mcpServers: {},
            skills: {}
          }
        });
      });
    });

    await Promise.all(operations);

    const history = getSharesHistory();
    expect(history.shares.length).toBe(30);

    const shareNames = history.shares.map((s) => s.name);
    for (let i = 0; i < 30; i++) {
      expect(shareNames).toContain(`concurrent-share-${i}`);
    }

    // Verify shares.json file is valid JSON on disk
    const sharesFile = path.join(tmpDir, "shares.json");
    expect(fs.existsSync(sharesFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(sharesFile, "utf8"));
    expect(parsed.shares.length).toBe(30);
  });

  it("handles 30 concurrent saveAuthConfig calls while preserving mode 0o600", async () => {
    const operations = Array.from({ length: 30 }, (_, i) => {
      return Promise.resolve().then(() => {
        saveAuthConfig({
          githubToken: `ghp_token_${i}`,
          githubUser: `user_${i}`
        });
      });
    });

    await Promise.all(operations);

    const config = getAuthConfig();
    expect(typeof config.githubToken).toBe("string");
    expect(config.githubToken?.startsWith("ghp_token_")).toBe(true);

    const configFile = path.join(tmpDir, "config.json");
    expect(fs.existsSync(configFile)).toBe(true);
    const stat = fs.statSync(configFile);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("recovers gracefully when shares.json or config.json is an unexpected directory", () => {
    const fakeSharesDir = path.join(tmpDir, "shares.json");
    fs.mkdirSync(fakeSharesDir, { recursive: true });

    const fakeConfigDir = path.join(tmpDir, "config.json");
    fs.mkdirSync(fakeConfigDir, { recursive: true });

    // Should return safe defaults rather than throwing unhandled fatal crash
    const history = getSharesHistory();
    expect(history.shares).toEqual([]);

    const config = getAuthConfig();
    expect(config.githubToken).toBeUndefined();
  });

  it("routes high-volume concurrent operations through custom in-memory StorageProvider", async () => {
    const memoryStore = new Map<string, string>();

    const customProvider: StorageProvider = {
      name: "in-memory-test",
      getItem: (key) => memoryStore.get(key) ?? null,
      setItem: (key, value) => {
        memoryStore.set(key, value);
      },
      removeItem: (key) => {
        memoryStore.delete(key);
      }
    };

    registerStorageProvider(customProvider);

    // Save auth config in custom provider
    saveAuthConfig({ githubToken: "ghp_custom_mem", githubUser: "memuser" });
    expect(getAuthConfig().githubToken).toBe("ghp_custom_mem");
    expect(memoryStore.has("config")).toBe(true);

    // Record 20 shares in custom provider
    for (let i = 0; i < 20; i++) {
      recordShare({
        name: `mem-share-${i}`,
        version: "1.0.0",
        targetType: "gist",
        targetUrl: `https://gist.github.com/mem/share-${i}`,
        lastSharedAt: new Date().toISOString(),
        fingerprints: {
          mcpServers: {},
          skills: {}
        }
      });
    }

    const history = getSharesHistory();
    expect(history.shares.length).toBe(20);
    expect(memoryStore.has("shares")).toBe(true);

    // Clear auth in custom provider
    clearAuthConfig();
    expect(getAuthConfig().githubToken).toBeUndefined();
    expect(memoryStore.has("config")).toBe(false);
  });
});
