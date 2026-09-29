import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as p from "@clack/prompts";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  authLoginCommand,
  authLogoutCommand,
  authStatusCommand
} from "../packages/cli/src/commands/auth/index.ts";
import {
  getAllAuthProviders,
  getAuthProvider,
  GitHubAuthProvider,
  registerAuthProvider,
  resetAuthProviders,
  unregisterAuthProvider,
  type AuthProvider,
  type AuthUser
} from "../packages/core/src/core/auth/index.ts";
import { GitHubClient } from "../packages/core/src/core/github.ts";
import {
  clearAuthConfig,
  clearProviderAuth,
  getAuthConfig,
  getAuthToken,
  getStoredAuthConfig,
  saveAuthConfig,
  saveProviderAuth
} from "../packages/core/src/core/state/index.ts";
import { AuthConfigSchema, ProviderAuthInfoSchema } from "../packages/core/src/types/index.ts";

describe("Pluggable Auth Provider Strategy & Registry", () => {
  let testDir: string;
  let originalSmcpDir: string | undefined;
  let originalGithubToken: string | undefined;
  let originalGhToken: string | undefined;
  let originalCustomToken: string | undefined;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `smcp-auth-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    originalSmcpDir = process.env.SMCP_DIR;
    originalGithubToken = process.env.GITHUB_TOKEN;
    originalGhToken = process.env.GH_TOKEN;
    originalCustomToken = process.env.CUSTOM_AUTH_TOKEN;

    process.env.SMCP_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.CUSTOM_AUTH_TOKEN;

    resetAuthProviders();
  });

  afterEach(() => {
    resetAuthProviders();

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

    if (originalGhToken !== undefined) {
      process.env.GH_TOKEN = originalGhToken;
    } else {
      delete process.env.GH_TOKEN;
    }

    if (originalCustomToken !== undefined) {
      process.env.CUSTOM_AUTH_TOKEN = originalCustomToken;
    } else {
      delete process.env.CUSTOM_AUTH_TOKEN;
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Schema Validation (AuthConfigSchema & ProviderAuthInfoSchema)", () => {
    it("validates ProviderAuthInfoSchema", () => {
      const valid = ProviderAuthInfoSchema.parse({
        username: "testuser",
        scopes: ["read", "write"],
        endpoint: "https://api.example.com",
        metadata: { tier: "pro" }
      });
      expect(valid.username).toBe("testuser");
      expect(valid.scopes).toEqual(["read", "write"]);
      expect(valid.endpoint).toBe("https://api.example.com");
      expect(valid.metadata?.tier).toBe("pro");
    });

    it("parses empty AuthConfigSchema with defaults and passthrough properties", () => {
      const parsed = AuthConfigSchema.parse({
        customField: "preserved-value"
      });
      expect(parsed.tokens).toEqual({});
      expect(parsed.providers).toEqual({});
      expect((parsed as Record<string, unknown>).customField).toBe("preserved-value");
    });

    it("parses AuthConfigSchema with tokens and providers", () => {
      const parsed = AuthConfigSchema.parse({
        githubToken: "ghp_123",
        githubUser: "octo",
        tokens: {
          github: "ghp_123",
          gitlab: "glpat_456"
        },
        providers: {
          gitlab: {
            username: "gitlab-user",
            scopes: ["api"]
          }
        }
      });

      expect(parsed.githubToken).toBe("ghp_123");
      expect(parsed.tokens?.gitlab).toBe("glpat_456");
      expect(parsed.providers?.gitlab?.username).toBe("gitlab-user");
    });
  });

  describe("GitHubAuthProvider Built-in Strategy", () => {
    it("has correct metadata and instructions", () => {
      const provider = new GitHubAuthProvider();
      expect(provider.id).toBe("github");
      expect(provider.name).toBe("GitHub");
      expect(provider.envVars).toEqual(["GITHUB_TOKEN", "GH_TOKEN"]);
      expect(provider.getInstructions()).toContain("https://github.com/settings/tokens/new");
      expect(provider.getInstructions()).toContain("scopes=gist,repo");
    });

    it("verifies token using GitHubClient and formats AuthUser", async () => {
      const provider = new GitHubAuthProvider();
      const origVerify = GitHubClient.prototype.verifyUser;
      GitHubClient.prototype.verifyUser = async () => ({
        login: "octocat",
        name: "Mona Lisa",
        id: 12345,
        scopes: ["gist", "repo"],
        hasRepoScope: true,
        hasGistScope: true
      });

      try {
        const user = await provider.verify("ghp_mock_token");
        expect(user.username).toBe("octocat");
        expect(user.scopes).toEqual(["gist", "repo"]);
        expect(user.metadata?.hasRepoScope).toBe(true);
        expect(user.metadata?.hasGistScope).toBe(true);
        expect(user.metadata?.id).toBe(12345);
      } finally {
        GitHubClient.prototype.verifyUser = origVerify;
      }
    });
  });

  describe("Auth Provider Registry", () => {
    it("provides GitHub as default registered provider", () => {
      const providers = getAllAuthProviders();
      expect(providers.length).toBe(1);
      expect(providers[0].id).toBe("github");
      expect(getAuthProvider("github")).toBeDefined();
      expect(getAuthProvider("GITHUB")?.name).toBe("GitHub");
    });

    it("registers a custom auth provider and prepends by default", () => {
      const customProvider: AuthProvider = {
        id: "custom",
        name: "Custom Service",
        envVars: ["CUSTOM_AUTH_TOKEN"],
        verify: async (token) => ({ username: `user-${token}` })
      };

      registerAuthProvider(customProvider);

      const all = getAllAuthProviders();
      expect(all.length).toBe(2);
      expect(all[0].id).toBe("custom");
      expect(getAuthProvider("custom")?.name).toBe("Custom Service");
    });

    it("unregisters auth provider by id and restores via resetAuthProviders", () => {
      const customProvider: AuthProvider = {
        id: "custom",
        name: "Custom Service",
        envVars: ["CUSTOM_AUTH_TOKEN"],
        verify: async () => ({ username: "custom-user" })
      };

      registerAuthProvider(customProvider);
      expect(getAuthProvider("custom")).not.toBeNull();

      const removed = unregisterAuthProvider("custom");
      expect(removed).toBe(true);
      expect(getAuthProvider("custom")).toBeNull();

      resetAuthProviders();
      expect(getAuthProvider("github")).not.toBeNull();
      expect(getAllAuthProviders().length).toBe(1);
    });

    it("rejects prototype pollution keys in provider id", () => {
      expect(() => {
        registerAuthProvider({
          id: "__proto__",
          name: "Evil",
          envVars: ["EVIL_TOKEN"],
          verify: async () => ({ username: "evil" })
        });
      }).toThrow(/prototype pollution/);

      expect(() => {
        registerAuthProvider({
          id: "constructor",
          name: "Evil",
          envVars: ["EVIL_TOKEN"],
          verify: async () => ({ username: "evil" })
        });
      }).toThrow(/prototype pollution/);

      expect(getAuthProvider("__proto__")).toBeNull();
      expect(unregisterAuthProvider("__proto__")).toBe(false);
    });

    it("rejects invalid provider definitions", () => {
      expect(() => registerAuthProvider(null as any)).toThrow();
      expect(() => registerAuthProvider({ id: "bad name!" } as any)).toThrow();
      expect(() => registerAuthProvider({ id: "valid", name: "" } as any)).toThrow();
      expect(() => registerAuthProvider({ id: "valid", name: "Valid", envVars: "not-an-array" } as any)).toThrow();
      expect(() => registerAuthProvider({ id: "valid", name: "Valid", envVars: [], verify: "not-fn" } as any)).toThrow();
    });
  });

  describe("State Token Management (getAuthToken, saveProviderAuth, clearProviderAuth)", () => {
    it("resolves token from environment variable specified in provider.envVars", () => {
      process.env.GITHUB_TOKEN = "ghp_from_github_token";
      expect(getAuthToken("github")).toBe("ghp_from_github_token");

      delete process.env.GITHUB_TOKEN;
      process.env.GH_TOKEN = "ghp_from_gh_token";
      expect(getAuthToken("github")).toBe("ghp_from_gh_token");
    });

    it("resolves custom provider token from its custom envVars", () => {
      registerAuthProvider({
        id: "custom",
        name: "Custom",
        envVars: ["CUSTOM_AUTH_TOKEN"],
        verify: async () => ({ username: "custom" })
      });

      process.env.CUSTOM_AUTH_TOKEN = "custom_secret_123";
      expect(getAuthToken("custom")).toBe("custom_secret_123");
    });

    it("resolves token from config.tokens when env var is absent", () => {
      saveAuthConfig({
        tokens: {
          github: "ghp_saved_token",
          custom: "custom_saved_token"
        }
      });

      expect(getAuthToken("github")).toBe("ghp_saved_token");
      expect(getAuthToken("custom")).toBe("custom_saved_token");
    });

    it("falls back to legacy config.githubToken for github provider", () => {
      saveAuthConfig({
        githubToken: "ghp_legacy_fallback"
      });

      expect(getAuthToken("github")).toBe("ghp_legacy_fallback");
    });

    it("returns undefined for unknown or unset providers", () => {
      expect(getAuthToken("nonexistent")).toBeUndefined();
      expect(getAuthToken("__proto__")).toBeUndefined();
    });

    it("saveProviderAuth updates tokens, providers, and legacy github fields", () => {
      saveProviderAuth("github", "ghp_new_token", {
        username: "octocat",
        scopes: ["gist", "repo"],
        metadata: { hasRepoScope: true }
      });

      const config = getAuthConfig();
      expect(config.tokens?.github).toBe("ghp_new_token");
      expect(config.providers?.github?.username).toBe("octocat");
      expect(config.providers?.github?.scopes).toEqual(["gist", "repo"]);
      expect(config.githubToken).toBe("ghp_new_token");
      expect(config.githubUser).toBe("octocat");
    });

    it("saveProviderAuth persists non-github providers without overwriting legacy fields", () => {
      saveAuthConfig({
        githubToken: "ghp_existing",
        githubUser: "octo"
      });

      saveProviderAuth("custom", "custom_key_456", {
        username: "custom-dev"
      });

      const config = getAuthConfig();
      expect(config.tokens?.custom).toBe("custom_key_456");
      expect(config.providers?.custom?.username).toBe("custom-dev");
      expect(config.githubToken).toBe("ghp_existing");
      expect(config.githubUser).toBe("octo");
    });

    it("saveProviderAuth does not leak process.env.GITHUB_TOKEN into persistent storage", () => {
      process.env.GITHUB_TOKEN = "transient_ci_token_12345";

      saveProviderAuth("gitlab", "glpat_test_token", {
        username: "gitlab-user"
      });

      // getStoredAuthConfig reads raw storage without process.env overrides
      const stored = getStoredAuthConfig();
      expect(stored.tokens?.gitlab).toBe("glpat_test_token");
      expect(stored.providers?.gitlab?.username).toBe("gitlab-user");
      expect(stored.githubToken).toBeUndefined();
      expect(stored.githubUser).toBeUndefined();

      // getAuthConfig() still reflects environment variable override at runtime
      expect(getAuthConfig().githubToken).toBe("transient_ci_token_12345");

      // Once env var is unset, stored config does not contain the transient token
      delete process.env.GITHUB_TOKEN;
      expect(getAuthConfig().githubToken).toBeUndefined();
    });

    it("clearProviderAuth deletes provider credentials and clears file if last token", () => {
      saveProviderAuth("github", "ghp_to_clear", { username: "temp" });
      expect(getAuthToken("github")).toBe("ghp_to_clear");

      clearProviderAuth("github");
      expect(getAuthToken("github")).toBeUndefined();
      expect(getAuthConfig()).toEqual({});
    });

    it("clearProviderAuth preserves other providers if multiple exist", () => {
      saveProviderAuth("github", "ghp_token", { username: "octo" });
      saveProviderAuth("custom", "custom_token", { username: "custom-user" });

      clearProviderAuth("github");

      const config = getAuthConfig();
      expect(config.tokens?.github).toBeUndefined();
      expect(config.githubToken).toBeUndefined();
      expect(config.tokens?.custom).toBe("custom_token");
      expect(config.providers?.custom?.username).toBe("custom-user");
    });
  });

  describe("Commands Auth Integration with Providers", () => {
    it("authLoginCommand logs error when given unsupported provider", async () => {
      let loggedError = "";
      const errorSpy = spyOn(p.log, "error").mockImplementation((msg: string) => {
        loggedError = msg;
      });

      try {
        await authLoginCommand("unsupported-service");
        expect(loggedError).toContain("Unsupported auth provider");
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("authLoginCommand logs in successfully with custom provider", async () => {
      registerAuthProvider({
        id: "custom",
        name: "Custom Hub",
        envVars: ["CUSTOM_HUB_TOKEN"],
        verify: async (token) => {
          if (token !== "valid-token") throw new Error("Invalid custom token");
          return { username: "custom-user", scopes: ["read", "write"] };
        },
        getInstructions: () => "Get token at https://custom.hub/tokens"
      });

      const passSpy = spyOn(p, "password").mockImplementation((async () => "valid-token") as any);

      try {
        await authLoginCommand("custom");
        const config = getAuthConfig();
        expect(config.tokens?.custom).toBe("valid-token");
        expect(config.providers?.custom?.username).toBe("custom-user");
      } finally {
        passSpy.mockRestore();
      }
    });

    it("authStatusCommand reports status for custom provider", async () => {
      registerAuthProvider({
        id: "custom",
        name: "Custom Hub",
        envVars: ["CUSTOM_HUB_TOKEN"],
        verify: async (token) => ({
          username: "custom-user",
          scopes: ["all-access"]
        })
      });

      saveProviderAuth("custom", "custom-valid", {
        username: "custom-user",
        scopes: ["all-access"]
      });

      let loggedInfo = "";
      const infoSpy = spyOn(p.log, "info").mockImplementation((msg?: string) => {
        loggedInfo = msg || "";
      });

      try {
        await authStatusCommand("custom");
        expect(loggedInfo).toContain("all-access");
      } finally {
        infoSpy.mockRestore();
      }
    });

    it("authStatusCommand reports warn when custom provider not logged in", async () => {
      registerAuthProvider({
        id: "custom",
        name: "Custom Hub",
        envVars: ["CUSTOM_HUB_TOKEN"],
        verify: async () => ({ username: "custom" })
      });

      let loggedWarn = "";
      const warnSpy = spyOn(p.log, "warn").mockImplementation((msg: string) => {
        loggedWarn = msg;
      });

      try {
        await authStatusCommand("custom");
        expect(loggedWarn).toContain("Not logged in");
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("authLogoutCommand logs out from custom provider", () => {
      saveProviderAuth("github", "ghp_tok", { username: "octo" });
      saveProviderAuth("custom", "cust_tok", { username: "dev" });

      authLogoutCommand("custom");

      expect(getAuthToken("custom")).toBeUndefined();
      expect(getAuthToken("github")).toBe("ghp_tok");
    });
  });
});
