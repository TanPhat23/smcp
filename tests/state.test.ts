import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearAuthConfig,
  getAuthConfig,
  getSharesHistory,
  getSmcpDir,
  recordShare,
  saveAuthConfig
} from "../src/core/state/index.ts";
import type { ShareRecord } from "../src/types/index.ts";

describe("State Management (Local Config & History)", () => {
  let testDir: string;
  let originalGithubToken: string | undefined;
  let originalSmcpDir: string | undefined;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), "smcp-state-test-" + Date.now() + "-" + Math.random().toString(36).slice(2));
    originalGithubToken = process.env.GITHUB_TOKEN;
    originalSmcpDir = process.env.SMCP_DIR;

    process.env.SMCP_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    if (originalGithubToken !== undefined) {
      process.env.GITHUB_TOKEN = originalGithubToken;
    } else {
      delete process.env.GITHUB_TOKEN;
    }

    if (originalSmcpDir !== undefined) {
      process.env.SMCP_DIR = originalSmcpDir;
    } else {
      delete process.env.SMCP_DIR;
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("getSmcpDir", () => {
    it("returns default path in home directory when SMCP_DIR is unset", () => {
      delete process.env.SMCP_DIR;
      expect(getSmcpDir()).toBe(path.join(os.homedir(), ".smcp"));
    });

    it("expands home directory tilde in SMCP_DIR using expandHome", () => {
      process.env.SMCP_DIR = "~/custom-smcp-dir";
      const expected = path.resolve(os.homedir(), "custom-smcp-dir");
      expect(getSmcpDir()).toBe(expected);
    });
  });

  describe("getAuthConfig", () => {
    it("returns empty object when no config file exists and no env var is set", () => {
      const config = getAuthConfig();
      expect(config).toEqual({});
    });

    it("returns environment variable override when GITHUB_TOKEN is set", () => {
      process.env.GITHUB_TOKEN = "ghp_envToken123456789";

      const config = getAuthConfig();
      expect(config.githubToken).toBe("ghp_envToken123456789");
    });

    it("ignores whitespace-only GITHUB_TOKEN environment variable", () => {
      saveAuthConfig({
        githubToken: "ghp_savedToken111",
        githubUser: "saved-user"
      });

      process.env.GITHUB_TOKEN = "   \t  \n  ";

      const config = getAuthConfig();
      expect(config.githubToken).toBe("ghp_savedToken111");
      expect(config.githubUser).toBe("saved-user");
    });

    it("prefers GITHUB_TOKEN environment variable over saved config", () => {
      saveAuthConfig({
        githubToken: "ghp_savedToken111",
        githubUser: "saved-user"
      });

      process.env.GITHUB_TOKEN = "ghp_overrideToken999";

      const config = getAuthConfig();
      expect(config.githubToken).toBe("ghp_overrideToken999");
      expect(config.githubUser).toBe("saved-user");
    });

    it("loads saved config from config.json when GITHUB_TOKEN is not set", () => {
      saveAuthConfig({
        githubToken: "ghp_fileTokenABC",
        githubUser: "octocat"
      });

      const config = getAuthConfig();
      expect(config).toEqual({
        githubToken: "ghp_fileTokenABC",
        githubUser: "octocat"
      });
    });

    it("recovers gracefully and returns empty object if config.json is corrupt JSON", () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, "config.json"), "{ corrupt json !!!", "utf8");

      const config = getAuthConfig();
      expect(config).toEqual({});
    });

    it("recovers gracefully and returns empty object if config.json has invalid schema", () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(
        path.join(testDir, "config.json"),
        JSON.stringify({ githubToken: 12345, githubUser: true }),
        "utf8"
      );

      const config = getAuthConfig();
      expect(config).toEqual({});
    });
  });

  describe("saveAuthConfig", () => {
    it("writes config.json with mode 0o600 (owner read and write only)", () => {
      saveAuthConfig({
        githubToken: "ghp_secureToken123",
        githubUser: "test-user"
      });

      const configFile = path.join(testDir, "config.json");
      expect(fs.existsSync(configFile)).toBe(true);

      const stat = fs.statSync(configFile);
      if (process.platform !== "win32") {
        const permissions = stat.mode & 0o777;
        expect(permissions).toBe(0o600);
      }

      const content = JSON.parse(fs.readFileSync(configFile, "utf8"));
      expect(content.githubToken).toBe("ghp_secureToken123");
      expect(content.githubUser).toBe("test-user");
    });

    it("ensures mode 0o600 even if the file previously had loose permissions", () => {
      fs.mkdirSync(testDir, { recursive: true });
      const configFile = path.join(testDir, "config.json");
      fs.writeFileSync(configFile, "{}", { mode: 0o666 });
      fs.chmodSync(configFile, 0o666);

      saveAuthConfig({ githubToken: "ghp_fixedModeToken" });

      const stat = fs.statSync(configFile);
      if (process.platform !== "win32") {
        expect(stat.mode & 0o777).toBe(0o600);
      }
    });

    it("writes config atomically without leaving temporary files", () => {
      saveAuthConfig({
        githubToken: "ghp_atomic123"
      });

      const files = fs.readdirSync(testDir);
      expect(files).toContain("config.json");
      const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles.length).toBe(0);
    });

    it("validates config against AuthConfigSchema and rejects invalid types", () => {
      expect(() => {
        saveAuthConfig({ githubToken: 12345 as unknown as string });
      }).toThrow();

      expect(() => {
        saveAuthConfig({ githubUser: ["invalid"] as unknown as string });
      }).toThrow();
    });
  });

  describe("clearAuthConfig", () => {
    it("removes the config.json file and clears state", () => {
      saveAuthConfig({ githubToken: "ghp_to_be_deleted", githubUser: "bye" });
      const configFile = path.join(testDir, "config.json");
      expect(fs.existsSync(configFile)).toBe(true);

      clearAuthConfig();
      expect(fs.existsSync(configFile)).toBe(false);
      expect(getAuthConfig()).toEqual({});
    });

    it("does not throw if config.json does not exist", () => {
      expect(() => clearAuthConfig()).not.toThrow();
    });

    it("rethrows non-ENOENT errors when clearing auth config", () => {
      saveAuthConfig({ githubToken: "ghp_to_be_deleted", githubUser: "bye" });
      const originalUnlinkSync = fs.unlinkSync;
      try {
        fs.unlinkSync = () => {
          const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
          err.code = "EACCES";
          throw err;
        };

        expect(() => clearAuthConfig()).toThrow(/EACCES/);
      } finally {
        fs.unlinkSync = originalUnlinkSync;
      }
    });
  });

  describe("getSharesHistory & recordShare", () => {
    it("returns empty shares array when shares.json does not exist", () => {
      const history = getSharesHistory();
      expect(history).toEqual({ shares: [] });
    });

    it("records a new share and persists it to shares.json", () => {
      const sampleShare: ShareRecord = {
        name: "my-starter-pack",
        version: "1.0.0",
        targetType: "gist",
        targetUrl: "https://gist.github.com/octocat/123456",
        gistId: "123456",
        lastSharedAt: "2026-09-26T12:00:00.000Z",
        fingerprints: {
          mcpServers: { github: "hash_gh_1" },
          skills: { "git-helper": "hash_skill_1" }
        }
      };

      recordShare(sampleShare);

      const history = getSharesHistory();
      expect(history.shares.length).toBe(1);
      expect(history.shares[0]).toEqual(sampleShare);

      const sharesFile = path.join(testDir, "shares.json");
      expect(fs.existsSync(sharesFile)).toBe(true);
    });

    it("writes shares atomically without leaving temporary files", () => {
      const sampleShare: ShareRecord = {
        name: "test-atomic-share",
        version: "1.0.0",
        targetType: "gist",
        targetUrl: "https://gist.github.com/octocat/123456",
        gistId: "123456",
        lastSharedAt: "2026-09-26T12:00:00.000Z",
        fingerprints: {
          mcpServers: {},
          skills: {}
        }
      };

      recordShare(sampleShare);

      const files = fs.readdirSync(testDir);
      expect(files).toContain("shares.json");
      const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles.length).toBe(0);
    });

    it("updates an existing share by name rather than duplicating it", () => {
      const shareV1: ShareRecord = {
        name: "my-starter-pack",
        version: "1.0.0",
        targetType: "gist",
        targetUrl: "https://gist.github.com/octocat/123456",
        gistId: "123456",
        lastSharedAt: "2026-09-26T12:00:00.000Z",
        fingerprints: {
          mcpServers: { github: "hash_gh_1" },
          skills: {}
        }
      };

      const otherShare: ShareRecord = {
        name: "second-pack",
        version: "0.1.0",
        targetType: "local",
        targetUrl: "/tmp/packs/second",
        lastSharedAt: "2026-09-26T12:05:00.000Z",
        fingerprints: {
          mcpServers: {},
          skills: { "unit-test": "hash_ut" }
        }
      };

      recordShare(shareV1);
      recordShare(otherShare);

      let history = getSharesHistory();
      expect(history.shares.length).toBe(2);

      const shareV2: ShareRecord = {
        name: "my-starter-pack",
        version: "1.1.0",
        targetType: "gist",
        targetUrl: "https://gist.github.com/octocat/123456",
        gistId: "123456",
        lastSharedAt: "2026-09-26T13:00:00.000Z",
        fingerprints: {
          mcpServers: { github: "hash_gh_2" },
          skills: { "new-skill": "hash_skill_2" }
        }
      };

      recordShare(shareV2);

      history = getSharesHistory();
      expect(history.shares.length).toBe(2);

      const updated = history.shares.find((s) => s.name === "my-starter-pack");
      expect(updated).toBeDefined();
      expect(updated?.version).toBe("1.1.0");
      expect(updated?.fingerprints.skills["new-skill"]).toBe("hash_skill_2");

      const untouched = history.shares.find((s) => s.name === "second-pack");
      expect(untouched).toBeDefined();
      expect(untouched?.version).toBe("0.1.0");
    });

    it("recovers gracefully and returns empty shares array if shares.json is corrupted", () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, "shares.json"), "{ invalid corrupt content !!!", "utf8");

      const history = getSharesHistory();
      expect(history).toEqual({ shares: [] });
    });

    it("recovers gracefully if shares.json schema is invalid", () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, "shares.json"), JSON.stringify({ shares: "not-an-array" }), "utf8");

      const history = getSharesHistory();
      expect(history).toEqual({ shares: [] });
    });

    it("validates input with ShareRecordSchema before recording", () => {
      expect(() => {
        recordShare({
          name: "bad-share",
          version: "invalid-semver",
          targetType: "gist",
          targetUrl: "https://gist.github.com",
          lastSharedAt: new Date().toISOString(),
          fingerprints: { mcpServers: {}, skills: {} }
        });
      }).toThrow();

      expect(() => {
        recordShare({
          name: "bad-target",
          version: "1.0.0",
          targetType: "unknown" as unknown as "gist",
          targetUrl: "https://example.com",
          lastSharedAt: new Date().toISOString(),
          fingerprints: { mcpServers: {}, skills: {} }
        });
      }).toThrow();
    });
  });
});
