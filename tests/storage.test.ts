import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearAuthConfig,
  FileStorageProvider,
  getAuthConfig,
  getConfigPath,
  getSharesHistory,
  getSharesPath,
  getSmcpDir,
  getStorageProvider,
  recordShare,
  registerStorageProvider,
  resetStorageProvider,
  saveAuthConfig,
  type StorageProvider
} from "../src/core/state/index.ts";
import type { ShareRecord } from "../src/types/index.ts";

class MemoryStorageProvider implements StorageProvider {
  readonly name = "memory";
  readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe("Pluggable Storage Provider Strategy", () => {
  let testDir: string;
  let originalSmcpDir: string | undefined;
  let originalGithubToken: string | undefined;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-storage-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    originalSmcpDir = process.env.SMCP_DIR;
    originalGithubToken = process.env.GITHUB_TOKEN;

    process.env.SMCP_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
    resetStorageProvider();
  });

  afterEach(() => {
    resetStorageProvider();

    if (originalSmcpDir !== undefined) {
      process.env.SMCP_DIR = originalSmcpDir;
    } else {
      delete process.env.SMCP_DIR;
    }

    if (originalGithubToken !== undefined) {
      process.env.GITHUB_TOKEN = originalGithubToken;
    } else {
      delete process.env.GITHUB_TOKEN;
    }

    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  describe("FileStorageProvider", () => {
    it("has name 'file'", () => {
      const provider = new FileStorageProvider();
      expect(provider.name).toBe("file");
    });

    it("returns null for non-existent item", () => {
      const provider = new FileStorageProvider();
      expect(provider.getItem("config")).toBeNull();
      expect(provider.getItem("shares")).toBeNull();
      expect(provider.getItem("custom")).toBeNull();
    });

    it("writes and reads back standard keys ('config' and 'shares')", () => {
      const provider = new FileStorageProvider();

      provider.setItem("config", JSON.stringify({ test: "configValue" }));
      expect(provider.getItem("config")).toBe(JSON.stringify({ test: "configValue" }));
      expect(fs.existsSync(getConfigPath())).toBe(true);

      provider.setItem("shares", JSON.stringify({ test: "sharesValue" }));
      expect(provider.getItem("shares")).toBe(JSON.stringify({ test: "sharesValue" }));
      expect(fs.existsSync(getSharesPath())).toBe(true);
    });

    it("writes with 0o600 file permissions", () => {
      const provider = new FileStorageProvider();
      provider.setItem("config", "sensitive-content");

      const configFile = getConfigPath();
      expect(fs.existsSync(configFile)).toBe(true);
      const stat = fs.statSync(configFile);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it("writes and reads custom key mapped to <smcpDir>/<key>.json", () => {
      const provider = new FileStorageProvider();
      provider.setItem("custom-state", JSON.stringify({ flag: true }));

      expect(provider.getItem("custom-state")).toBe(JSON.stringify({ flag: true }));
      const expectedPath = path.join(getSmcpDir(), "custom-state.json");
      expect(fs.existsSync(expectedPath)).toBe(true);
    });

    it("removes files and ignores ENOENT when deleting non-existent file", () => {
      const provider = new FileStorageProvider();
      provider.setItem("config", "temp");
      expect(provider.getItem("config")).toBe("temp");

      provider.removeItem("config");
      expect(provider.getItem("config")).toBeNull();
      expect(fs.existsSync(getConfigPath())).toBe(false);

      // Removing again should not throw (ignores ENOENT)
      expect(() => provider.removeItem("config")).not.toThrow();
      expect(() => provider.removeItem("shares")).not.toThrow();
    });

    it("rejects invalid keys (empty, whitespace, non-string)", () => {
      const provider = new FileStorageProvider();

      expect(() => provider.getItem("")).toThrow(/Invalid storage key/);
      expect(() => provider.getItem("   ")).toThrow(/Invalid storage key/);
      expect(() => provider.getItem(null as any)).toThrow(/Invalid storage key/);
      expect(() => provider.getItem(undefined as any)).toThrow(/Invalid storage key/);

      expect(() => provider.setItem("", "val")).toThrow(/Invalid storage key/);
      expect(() => provider.removeItem("")).toThrow(/Invalid storage key/);
    });

    it("rejects path traversal keys", () => {
      const provider = new FileStorageProvider();

      const traversalKeys = [
        "../traversal",
        "..",
        ".",
        "foo/bar",
        "foo\\bar",
        "/etc/passwd",
        "c:\\windows",
        "nested/../../secret",
        "null\0byte",
        "colon:key",
        "star*key",
        "question?key",
        "pipe|key"
      ];

      for (const key of traversalKeys) {
        expect(() => provider.getItem(key)).toThrow(/Invalid storage key/);
        expect(() => provider.setItem(key, "data")).toThrow(/Invalid storage key/);
        expect(() => provider.removeItem(key)).toThrow(/Invalid storage key/);
      }
    });

    it("rejects prototype pollution keys", () => {
      const provider = new FileStorageProvider();

      const protoKeys = ["__proto__", "constructor", "prototype"];

      for (const key of protoKeys) {
        expect(() => provider.getItem(key)).toThrow(/Invalid storage key/);
        expect(() => provider.setItem(key, "data")).toThrow(/Invalid storage key/);
        expect(() => provider.removeItem(key)).toThrow(/Invalid storage key/);
      }
    });

    it("rejects non-string values on setItem", () => {
      const provider = new FileStorageProvider();
      expect(() => provider.setItem("config", null as any)).toThrow(/must be a string/);
      expect(() => provider.setItem("config", 123 as any)).toThrow(/must be a string/);
      expect(() => provider.setItem("config", {} as any)).toThrow(/must be a string/);
    });
  });

  describe("Storage Provider Registry", () => {
    it("returns FileStorageProvider by default", () => {
      const active = getStorageProvider();
      expect(active).toBeInstanceOf(FileStorageProvider);
      expect(active.name).toBe("file");
    });

    it("registers custom StorageProvider and retrieves it", () => {
      const mem = new MemoryStorageProvider();
      registerStorageProvider(mem);

      expect(getStorageProvider()).toBe(mem);
      expect(getStorageProvider().name).toBe("memory");
    });

    it("resets active provider back to default FileStorageProvider", () => {
      const mem = new MemoryStorageProvider();
      registerStorageProvider(mem);
      expect(getStorageProvider()).toBe(mem);

      resetStorageProvider();
      expect(getStorageProvider()).toBeInstanceOf(FileStorageProvider);
      expect(getStorageProvider().name).toBe("file");
    });

    it("validates provider and rejects invalid objects", () => {
      expect(() => registerStorageProvider(null as any)).toThrow(/must be a non-null object/);
      expect(() => registerStorageProvider(undefined as any)).toThrow(/must be a non-null object/);
      expect(() => registerStorageProvider([] as any)).toThrow(/must be a non-null object/);
      expect(() => registerStorageProvider("string" as any)).toThrow(/must be a non-null object/);
    });

    it("validates provider name and rejects empty or whitespace name", () => {
      expect(() =>
        registerStorageProvider({
          name: "",
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {}
        })
      ).toThrow(/'name' must be a non-empty string/);

      expect(() =>
        registerStorageProvider({
          name: "   ",
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {}
        })
      ).toThrow(/'name' must be a non-empty string/);
    });

    it("rejects prototype pollution provider names", () => {
      for (const name of ["__proto__", "constructor", "prototype"]) {
        expect(() =>
          registerStorageProvider({
            name,
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {}
          })
        ).toThrow(/prototype pollution key/);
      }
    });

    it("validates provider methods (getItem, setItem, removeItem)", () => {
      expect(() =>
        registerStorageProvider({
          name: "mock",
          setItem: () => {},
          removeItem: () => {}
        } as any)
      ).toThrow(/must implement a 'getItem\(key\)' method/);

      expect(() =>
        registerStorageProvider({
          name: "mock",
          getItem: () => null,
          removeItem: () => {}
        } as any)
      ).toThrow(/must implement a 'setItem\(key, value\)' method/);

      expect(() =>
        registerStorageProvider({
          name: "mock",
          getItem: () => null,
          setItem: () => {}
        } as any)
      ).toThrow(/must implement a 'removeItem\(key\)' method/);
    });
  });

  describe("Custom StorageProvider Integration with Auth & History", () => {
    it("routes getAuthConfig, saveAuthConfig, and clearAuthConfig through custom provider without disk access", () => {
      const mem = new MemoryStorageProvider();
      registerStorageProvider(mem);

      // Initially empty
      expect(getAuthConfig()).toEqual({});
      expect(mem.map.has("config")).toBe(false);

      // Save auth config
      saveAuthConfig({
        tokens: { github: "ghp_mock_custom" },
        githubToken: "ghp_mock_custom"
      });

      // Stored in memory map
      expect(mem.map.has("config")).toBe(true);
      const rawStored = mem.map.get("config");
      expect(JSON.parse(rawStored!)).toEqual({
        tokens: { github: "ghp_mock_custom" },
        githubToken: "ghp_mock_custom",
        providers: {}
      });

      // No file created on disk
      expect(fs.existsSync(getConfigPath())).toBe(false);

      // Retrieved via getAuthConfig()
      const retrieved = getAuthConfig();
      expect(retrieved.githubToken).toBe("ghp_mock_custom");
      expect(retrieved.tokens?.github).toBe("ghp_mock_custom");

      // clearAuthConfig clears from provider
      clearAuthConfig();
      expect(mem.map.has("config")).toBe(false);
      expect(getAuthConfig()).toEqual({});
      expect(fs.existsSync(getConfigPath())).toBe(false);
    });

    it("preserves GITHUB_TOKEN environment variable override when using custom provider", () => {
      const mem = new MemoryStorageProvider();
      registerStorageProvider(mem);

      saveAuthConfig({
        githubToken: "ghp_stored_in_mem",
        tokens: { custom: "custom_token" }
      });

      process.env.GITHUB_TOKEN = "ghp_env_override";
      const config = getAuthConfig();
      expect(config.githubToken).toBe("ghp_env_override");
      expect(config.tokens?.custom).toBe("custom_token");
    });

    it("routes getSharesHistory and recordShare through custom provider without disk access", () => {
      const mem = new MemoryStorageProvider();
      registerStorageProvider(mem);

      // Initially empty
      expect(getSharesHistory()).toEqual({ shares: [] });
      expect(mem.map.has("shares")).toBe(false);

      const record: ShareRecord = {
        name: "in-memory-pack",
        version: "1.0.0",
        targetType: "gist",
        targetUrl: "https://gist.github.com/mock/123",
        lastSharedAt: "2026-09-29T12:00:00.000Z",
        fingerprints: {
          mcpServers: {},
          skills: {}
        }
      };

      recordShare(record);

      // In memory map
      expect(mem.map.has("shares")).toBe(true);
      // No file on disk
      expect(fs.existsSync(getSharesPath())).toBe(false);

      // Retrieved via getSharesHistory()
      const history = getSharesHistory();
      expect(history.shares.length).toBe(1);
      expect(history.shares[0]).toEqual(record);

      // Update existing record
      const updatedRecord: ShareRecord = {
        ...record,
        version: "1.1.0"
      };
      recordShare(updatedRecord);

      const updatedHistory = getSharesHistory();
      expect(updatedHistory.shares.length).toBe(1);
      expect(updatedHistory.shares[0].version).toBe("1.1.0");
      expect(fs.existsSync(getSharesPath())).toBe(false);
    });

    it("recovers gracefully when custom provider returns corrupt or invalid JSON", () => {
      const mem = new MemoryStorageProvider();
      registerStorageProvider(mem);

      mem.setItem("config", "{ invalid json");
      expect(getAuthConfig()).toEqual({});

      mem.setItem("config", JSON.stringify({ tokens: "not an object" }));
      expect(getAuthConfig()).toEqual({});

      mem.setItem("shares", "{ invalid json");
      expect(getSharesHistory()).toEqual({ shares: [] });

      mem.setItem("shares", JSON.stringify({ shares: "not an array" }));
      expect(getSharesHistory()).toEqual({ shares: [] });
    });
  });
});
