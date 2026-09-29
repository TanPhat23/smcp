import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as p from "@clack/prompts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  agentAddCommand,
  agentInstallSkillCommand,
  agentListCommand
} from "../src/commands/agent/index.ts";
import { instructionsCommand } from "../src/commands/instructions.ts";
import { authLoginCommand, authLogoutCommand, authStatusCommand } from "../src/commands/auth/index.ts";
import {
  extractPluginFiles,
  extractSkillFiles,
  installCommand,
  installPackIntoAgents,
  resolveActiveAgentPath,
  resolveMcpServerTemplates
} from "../src/commands/install/index.ts";
import { listCommand } from "../src/commands/list.ts";
import {
  bundlePluginFiles,
  bundleSkillFiles,
  exportPackLocally,
  shareCommand
} from "../src/commands/share/index.ts";
import { getAgentProfiles, saveCustomAgent } from "../src/core/agents/index.ts";
import { GitHubClient } from "../src/core/github.ts";
import { clearAuthConfig, getAuthConfig, getSharesHistory, recordShare, saveAuthConfig } from "../src/core/state/index.ts";
import type { AgentProfile, Manifest, McpServerConfig, PluginEntry, SkillEntry } from "../src/types/index.ts";

describe("Commands Implementation", () => {
  let testDir: string;
  let originalSmcpDir: string | undefined;
  let originalGithubToken: string | undefined;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-cmd-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(testDir, { recursive: true });

    originalSmcpDir = process.env.SMCP_DIR;
    originalGithubToken = process.env.GITHUB_TOKEN;

    process.env.SMCP_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
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

    delete process.env.SMCP_CUSTOM_AGENTS_PATH;

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("auth commands", () => {
    it("authLogoutCommand clears saved token from auth config", () => {
      saveAuthConfig({ githubToken: "ghp_temp123", githubUser: "testuser" });
      expect(getAuthConfig().githubToken).toBe("ghp_temp123");

      authLogoutCommand();

      expect(getAuthConfig().githubToken).toBeUndefined();
    });

    it("authStatusCommand warns when user is not logged in", async () => {
      let loggedWarning = "";
      const warnSpy = spyOn(p.log, "warn").mockImplementation((msg: string) => {
        loggedWarning = msg;
      });

      try {
        await authStatusCommand();
        expect(loggedWarning).toContain("Not logged in");
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("authStatusCommand reports success when token is valid", async () => {
      saveAuthConfig({ githubToken: "ghp_valid_token", githubUser: "octocat" });

      const origVerify = GitHubClient.prototype.verifyUser;
      GitHubClient.prototype.verifyUser = async () => ({
        login: "octocat",
        name: "Octocat"
      });

      try {
        await authStatusCommand();
      } finally {
        GitHubClient.prototype.verifyUser = origVerify;
      }
    });

    it("authStatusCommand reports scopes and confirms repositories are enabled when repo scope is present", async () => {
      saveAuthConfig({ githubToken: "ghp_valid_token", githubUser: "octocat" });

      const origVerify = GitHubClient.prototype.verifyUser;
      GitHubClient.prototype.verifyUser = async () => ({
        login: "octocat",
        name: "Octocat",
        scopes: ["gist", "repo"],
        hasRepoScope: true,
        hasGistScope: true
      });

      let loggedInfo = "";
      const infoSpy = spyOn(p.log, "info").mockImplementation((msg?: string) => {
        loggedInfo = msg || "";
      });

      try {
        await authStatusCommand();
        expect(loggedInfo).toContain("gist, repo");
        expect(loggedInfo).toContain("Repositories enabled");
        expect(loggedInfo).toContain("Gists enabled");
      } finally {
        GitHubClient.prototype.verifyUser = origVerify;
        infoSpy.mockRestore();
      }
    });

    it("authStatusCommand reports warning and regeneration tip when user token lacks repo scope", async () => {
      saveAuthConfig({ githubToken: "ghp_valid_token", githubUser: "octocat" });

      const origVerify = GitHubClient.prototype.verifyUser;
      GitHubClient.prototype.verifyUser = async () => ({
        login: "octocat",
        name: "Octocat",
        scopes: ["gist"],
        hasRepoScope: false,
        hasGistScope: true
      });

      let loggedInfo = "";
      let loggedMessage = "";
      const infoSpy = spyOn(p.log, "info").mockImplementation((msg?: string) => {
        loggedInfo = msg || "";
      });
      const messageSpy = spyOn(p.log, "message").mockImplementation((msg?: string) => {
        loggedMessage = msg || "";
      });

      try {
        await authStatusCommand();
        expect(loggedInfo).toContain("Missing 'repo' scope");
        expect(loggedMessage).toContain("Tip: To share packs directly to GitHub Repositories");
        expect(loggedMessage).toContain("https://github.com/settings/tokens/new?scopes=gist,repo");
      } finally {
        GitHubClient.prototype.verifyUser = origVerify;
        infoSpy.mockRestore();
        messageSpy.mockRestore();
      }
    });

    it("authStatusCommand reports error when stored token is invalid", async () => {
      saveAuthConfig({ githubToken: "ghp_invalid_token" });

      const origVerify = GitHubClient.prototype.verifyUser;
      GitHubClient.prototype.verifyUser = async () => {
        throw new Error("401 Bad credentials");
      };

      let loggedMsg = "";
      const messageSpy = spyOn(p.log, "message").mockImplementation((msg?: string) => {
        loggedMsg = msg || "";
      });

      try {
        await authStatusCommand();
        expect(loggedMsg).toContain("401 Bad credentials");
      } finally {
        GitHubClient.prototype.verifyUser = origVerify;
        messageSpy.mockRestore();
      }
    });

    it("authLoginCommand handles cancelled token prompt gracefully", async () => {
      const passSpy = spyOn(p, "password").mockImplementation((async () => Symbol("cancel")) as any);

      let cancelMessage = "";
      const cancelSpy = spyOn(p, "cancel").mockImplementation(((msg?: string) => {
        cancelMessage = msg || "";
      }) as any);

      try {
        await authLoginCommand();
        expect(cancelMessage).toContain("cancelled");
        expect(getAuthConfig().githubToken).toBeUndefined();
      } finally {
        passSpy.mockRestore();
        cancelSpy.mockRestore();
      }
    });

    it("authLoginCommand authenticates and saves valid token", async () => {
      const passSpy = spyOn(p, "password").mockImplementation((async () => "ghp_secret_valid_token") as any);

      const origVerify = GitHubClient.prototype.verifyUser;
      GitHubClient.prototype.verifyUser = async () => ({
        login: "myuser",
        name: "My User"
      });

      try {
        await authLoginCommand();
        const conf = getAuthConfig();
        expect(conf.githubToken).toBe("ghp_secret_valid_token");
        expect(conf.githubUser).toBe("myuser");
      } finally {
        passSpy.mockRestore();
        GitHubClient.prototype.verifyUser = origVerify;
      }
    });
  });

  describe("agent commands", () => {
    it("agentListCommand prints default agent profiles without throwing", () => {
      expect(() => agentListCommand()).not.toThrow();
    });

    it("agentAddCommand registers a custom agent into custom-agents.json", async () => {
      let promptIndex = 0;
      const answers = [
        "custom-test-agent", // id
        "Custom Test Agent", // name
        "~/.custom/mcp.json", // mcpPath
        "~/.custom/skills", // skillsPath
        "~/.custom/opencode.jsonc", // pluginsPath
        "~/.custom/plugin" // pluginsDir
      ];

      const textSpy = spyOn(p, "text").mockImplementation((async () => answers[promptIndex++]) as any);

      try {
        await agentAddCommand();

        const profiles = getAgentProfiles();
        expect(profiles["custom-test-agent"]).toBeDefined();
        expect(profiles["custom-test-agent"].name).toBe("Custom Test Agent");
        expect(profiles["custom-test-agent"].mcpConfig?.paths).toEqual(["~/.custom/mcp.json"]);
        expect(profiles["custom-test-agent"].skills?.paths).toEqual(["~/.custom/skills"]);
        expect(profiles["custom-test-agent"].plugins?.paths).toEqual(["~/.custom/opencode.jsonc"]);
        expect(profiles["custom-test-agent"].plugins?.dirPaths).toEqual(["~/.custom/plugin"]);
      } finally {
        textSpy.mockRestore();
      }
    });

    it("agentListCommand supports json output without throwing", () => {
      expect(() => agentListCommand({ json: true })).not.toThrow();
    });

    it("agentInstallSkillCommand runs cleanly in human and json modes", () => {
      expect(() => agentInstallSkillCommand()).not.toThrow();
      expect(() => agentInstallSkillCommand({ json: true })).not.toThrow();
    });

    it("instructionsCommand prints agent guidelines in text and json modes", () => {
      expect(() => instructionsCommand()).not.toThrow();
      expect(() => instructionsCommand({ json: true })).not.toThrow();
    });
  });

  describe("list command", () => {
    it("listCommand runs without throwing when no agents are detected", () => {
      expect(() => listCommand()).not.toThrow();
    });

    it("listCommand reads servers using custom mcpConfig.key from agent profile", () => {
      const customMcp = path.join(testDir, "custom-list-mcp.json");
      fs.writeFileSync(
        customMcp,
        JSON.stringify({
          customKey: {
            customKeyServer: { command: "node", args: ["custom.js"] }
          }
        }),
        "utf8"
      );

      const customProfilesPath = path.join(testDir, "custom-agents.json");
      process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
      saveCustomAgent("custom-list-agent", {
        name: "Custom List Agent",
        mcpConfig: { paths: [customMcp], key: "customKey" },
        skills: null
      });

      expect(() => listCommand()).not.toThrow();
    });

    it("listCommand filters by agents option and displays settings cleanly", () => {
      expect(() => listCommand({ agents: ["opencode"] })).not.toThrow();
      expect(() => listCommand({ agents: ["claude"], settings: true })).not.toThrow();
      expect(() => listCommand({ agents: ["nonexistent-agent"] })).not.toThrow();
    });

    it("listCommand outputs JSON with plugins field", () => {
      let logged = "";
      const origLog = console.log;
      console.log = (msg: string) => {
        logged = msg;
      };
      try {
        listCommand({ json: true });
        const parsed = JSON.parse(logged);
        expect(parsed.agents).toBeDefined();
        if (parsed.agents.length > 0) {
          expect(parsed.agents[0].plugins).toBeDefined();
        }
      } finally {
        console.log = origLog;
      }
    });
  });

  describe("share command helpers & local pack export", () => {
    it("bundleSkillFiles bundles directory skills and standalone markdown skills", () => {
      const skillDir = path.join(testDir, "test-skill");
      fs.mkdirSync(path.join(skillDir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Test Skill\nInstructions here.", "utf8");
      fs.writeFileSync(path.join(skillDir, "sub", "helper.txt"), "helper content", "utf8");

      const singleFile = path.join(testDir, "single.md");
      fs.writeFileSync(singleFile, "# Single Skill", "utf8");

      const skills: SkillEntry[] = [
        {
          name: "test-skill",
          path: path.join(skillDir, "SKILL.md"),
          description: "A directory skill"
        },
        {
          name: "single",
          path: singleFile,
          description: "A single file skill"
        }
      ];

      const { bundledSkills, gistFiles } = bundleSkillFiles(skills);

      expect(bundledSkills.length).toBe(2);

      const bundledDir = bundledSkills.find((s) => s.name === "test-skill");
      expect(bundledDir).toBeDefined();
      expect(bundledDir?.files?.["SKILL.md"]).toBe("# Test Skill\nInstructions here.");
      expect(bundledDir?.files?.["sub/helper.txt"]).toBe("helper content");
      expect(bundledDir?.contentHash).toBeDefined();

      const bundledSingle = bundledSkills.find((s) => s.name === "single");
      expect(bundledSingle).toBeDefined();
      expect(bundledSingle?.files?.["SKILL.md"]).toBe("# Single Skill");

      // Verify Gist filenames
      expect(gistFiles["skills_test-skill_SKILL.md"]).toBeDefined();
      expect(gistFiles["skills_test-skill_sub_helper.txt"]).toBeDefined();
      expect(gistFiles["skills_single_SKILL.md"]).toBeDefined();
    });

    it("bundleSkillFiles filters out hidden files and files in hidden directories", () => {
      const skillDir = path.join(testDir, "hidden-skill");
      fs.mkdirSync(path.join(skillDir, ".git"), { recursive: true });
      fs.mkdirSync(path.join(skillDir, ".hidden-dir"), { recursive: true });
      fs.mkdirSync(path.join(skillDir, "sub"), { recursive: true });

      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Skill with hidden files", "utf8");
      fs.writeFileSync(path.join(skillDir, ".DS_Store"), "binary junk", "utf8");
      fs.writeFileSync(path.join(skillDir, ".gitignore"), "node_modules", "utf8");
      fs.writeFileSync(path.join(skillDir, ".git", "config"), "git config", "utf8");
      fs.writeFileSync(path.join(skillDir, ".hidden-dir", "secret.txt"), "secret", "utf8");
      fs.writeFileSync(path.join(skillDir, "sub", ".hidden-sub"), "hidden sub", "utf8");
      fs.writeFileSync(path.join(skillDir, "sub", "valid.txt"), "valid content", "utf8");

      const skills: SkillEntry[] = [
        {
          name: "hidden-skill",
          path: path.join(skillDir, "SKILL.md"),
          description: "Skill with hidden files"
        }
      ];

      const { bundledSkills, gistFiles } = bundleSkillFiles(skills);
      const bundled = bundledSkills[0];
      expect(bundled).toBeDefined();
      expect(bundled.files).toBeDefined();

      // Non-hidden files must be present
      expect(bundled.files?.["SKILL.md"]).toBe("# Skill with hidden files");
      expect(bundled.files?.["sub/valid.txt"]).toBe("valid content");

      // Hidden files and files in hidden dirs must be omitted
      expect(bundled.files?.[".DS_Store"]).toBeUndefined();
      expect(bundled.files?.[".gitignore"]).toBeUndefined();
      expect(bundled.files?.[".git/config"]).toBeUndefined();
      expect(bundled.files?.[".hidden-dir/secret.txt"]).toBeUndefined();
      expect(bundled.files?.["sub/.hidden-sub"]).toBeUndefined();

      // Gist files must not include hidden files
      for (const gistKey of Object.keys(gistFiles)) {
        expect(gistKey).not.toContain(".DS_Store");
        expect(gistKey).not.toContain(".gitignore");
        expect(gistKey).not.toContain(".git");
        expect(gistKey).not.toContain(".hidden");
      }
    });

    it("exportPackLocally writes smcp.json and skill files to output directory", () => {
      const outDir = path.join(testDir, "exported-pack");
      const manifest: Manifest = {
        name: "exported-test-pack",
        version: "1.0.0",
        description: "Test local export",
        mcpServers: {
          sqlite: {
            command: "uvx",
            args: ["mcp-server-sqlite", "--db", "/tmp/test.db"]
          }
        },
        skills: [],
        requiredEnv: []
      };

      const bundledSkills: SkillEntry[] = [
        {
          name: "my-skill",
          path: "skills/my-skill/SKILL.md",
          files: {
            "SKILL.md": "# My Skill",
            "scripts/run.sh": "echo hello"
          }
        }
      ];

      exportPackLocally(manifest, bundledSkills, outDir);

      expect(fs.existsSync(path.join(outDir, "smcp.json"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "skills", "my-skill", "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "skills", "my-skill", "scripts", "run.sh"))).toBe(true);

      const savedManifest = JSON.parse(fs.readFileSync(path.join(outDir, "smcp.json"), "utf8"));
      expect(savedManifest.name).toBe("exported-test-pack");
    });

    it("shareCommand exports locally with options and records share in history", async () => {
      // Create a mock agent with an MCP server
      const agentMcpPath = path.join(testDir, "agent-mcp.json");
      fs.writeFileSync(
        agentMcpPath,
        JSON.stringify({
          mcpServers: {
            testServer: {
              command: "node",
              args: ["test.js"],
              env: { API_KEY: "secret-token-123456" }
            }
          }
        }),
        "utf8"
      );

      const customProfilesPath = path.join(testDir, "custom-agents.json");
      process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
      saveCustomAgent("mock-agent", {
        name: "Mock Agent",
        mcpConfig: { paths: [agentMcpPath], key: "mcpServers" },
        skills: null
      });

      const outDir = path.join(testDir, "shared-pack-out");

      await shareCommand({
        output: outDir,
        name: "my-shared-pack",
        description: "Exported via test",
        servers: ["testServer"],
        skills: []
      });

      expect(fs.existsSync(path.join(outDir, "smcp.json"))).toBe(true);
      const manifest: Manifest = JSON.parse(
        fs.readFileSync(path.join(outDir, "smcp.json"), "utf8")
      );
      expect(manifest.name).toBe("my-shared-pack");
      // Secret should be redacted!
      expect(manifest.mcpServers?.testServer?.env?.API_KEY).toBe("${API_KEY}");
      expect(manifest.requiredEnv?.some((r) => r.key === "API_KEY")).toBe(true);

      // Verify share recorded in history
      const history = getSharesHistory();
      const rec = history.shares.find((s) => s.name === "my-shared-pack");
      expect(rec).toBeDefined();
      expect(rec?.targetType).toBe("local");
      expect(rec?.targetUrl).toBe(path.resolve(outDir));
    });

    it("shareCommand reads servers using custom mcpConfig.key from agent profile", async () => {
      const customMcp = path.join(testDir, "custom-key-mcp.json");
      fs.writeFileSync(
        customMcp,
        JSON.stringify({
          customKey: {
            customKeyServer: { command: "node", args: ["custom.js"] }
          }
        }),
        "utf8"
      );

      const customProfilesPath = path.join(testDir, "custom-agents.json");
      process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
      saveCustomAgent("custom-key-agent", {
        name: "Custom Key Agent",
        mcpConfig: { paths: [customMcp], key: "customKey" },
        skills: null
      });

      const outDir = path.join(testDir, "custom-key-out");
      await shareCommand({
        output: outDir,
        name: "custom-key-pack",
        description: "Custom key test description",
        servers: ["customKeyServer"],
        skills: []
      });

      const manifestPath = path.join(outDir, "smcp.json");
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.mcpServers?.customKeyServer).toBeDefined();
    });

    it("bundlePluginFiles bundles string plugins, object plugins with files, and directory plugins", async () => {
      const pluginDir = path.join(testDir, "test-plugin-dir");
      fs.mkdirSync(path.join(pluginDir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(pluginDir, "index.ts"), "export const x = 10;", "utf8");
      fs.writeFileSync(path.join(pluginDir, "sub", "util.ts"), "export const y = 20;", "utf8");
      fs.writeFileSync(path.join(pluginDir, ".DS_Store"), "junk", "utf8");

      const plugins: PluginEntry[] = [
        "opencode-gemini-auth@latest",
        {
          name: "object-plugin-with-files",
          targetAgent: "opencode",
          description: "Plugin with explicit files",
          files: {
            "index.ts": "console.log('hello');"
          }
        },
        {
          name: "dir-plugin",
          path: pluginDir,
          description: "Plugin from local dir"
        }
      ];

      const { bundledPlugins, gistFiles } = await bundlePluginFiles(plugins);

      expect(bundledPlugins.length).toBe(3);

      const strPlugin = bundledPlugins.find((p) => p.name === "opencode-gemini-auth@latest");
      expect(strPlugin).toBeDefined();

      const objPlugin = bundledPlugins.find((p) => p.name === "object-plugin-with-files");
      expect(objPlugin).toBeDefined();
      expect(objPlugin?.files?.["index.ts"]).toBe("console.log('hello');");
      expect(gistFiles["plugins_object-plugin-with-files_index.ts"].content).toBe("console.log('hello');");

      const dirPlugin = bundledPlugins.find((p) => p.name === "dir-plugin");
      expect(dirPlugin).toBeDefined();
      expect(dirPlugin?.files?.["index.ts"]).toBe("export const x = 10;");
      expect(dirPlugin?.files?.["sub/util.ts"]).toBe("export const y = 20;");
      expect(dirPlugin?.files?.[".DS_Store"]).toBeUndefined();
      expect(gistFiles["plugins_dir-plugin_index.ts"]).toBeDefined();
      expect(gistFiles["plugins_dir-plugin_sub_util.ts"]).toBeDefined();
    });

    it("exportPackLocally exports both skills and plugins into destination directory", () => {
      const outDir = path.join(testDir, "exported-plugin-pack");
      const manifest: Manifest = {
        name: "exported-with-plugins",
        version: "1.0.0",
        description: "Test local export with plugins",
        mcpServers: {},
        skills: [],
        plugins: [
          {
            name: "plugin-with-script",
            files: { "main.ts": "export default {};" }
          }
        ],
        requiredEnv: []
      };

      const bundledPlugins: PluginEntry[] = [
        {
          name: "plugin-with-script",
          files: { "main.ts": "export default {};" }
        }
      ];

      exportPackLocally(manifest, [], outDir, bundledPlugins);

      expect(fs.existsSync(path.join(outDir, "smcp.json"))).toBe(true);
      expect(
        fs.existsSync(path.join(outDir, "plugins", "main.ts")) ||
        fs.existsSync(path.join(outDir, "plugins", "plugin-with-script", "main.ts"))
      ).toBe(true);
    });

    it("shareCommand exports plugins and records them in history", async () => {
      const opencodeConf = path.join(testDir, "opencode-share.json");
      fs.writeFileSync(
        opencodeConf,
        JSON.stringify({
          plugin: ["opencode-gemini-auth@latest"]
        }),
        "utf8"
      );

      const customProfilesPath = path.join(testDir, "custom-agents.json");
      process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
      saveCustomAgent("plugin-agent", {
        name: "Plugin Agent",
        mcpConfig: null,
        skills: null,
        plugins: {
          paths: [opencodeConf],
          key: "plugin",
          format: "array"
        }
      });

      const outDir = path.join(testDir, "shared-plugin-pack-out");

      await shareCommand({
        output: outDir,
        name: "plugin-pack",
        description: "Exported with plugin",
        plugins: ["opencode-gemini-auth@latest"],
        servers: [],
        skills: []
      });

      expect(fs.existsSync(path.join(outDir, "smcp.json"))).toBe(true);
      const manifest: Manifest = JSON.parse(
        fs.readFileSync(path.join(outDir, "smcp.json"), "utf8")
      );
      expect(manifest.name).toBe("plugin-pack");
      expect(manifest.plugins).toBeDefined();
      expect(manifest.plugins?.some((p) => (typeof p === "string" ? p : p.name) === "opencode-gemini-auth@latest")).toBe(true);

      const history = getSharesHistory();
      const rec = history.shares.find((s) => s.name === "plugin-pack");
      expect(rec).toBeDefined();
    });

    const setupMockAgentWithServer = () => {
      const agentMcpPath = path.join(testDir, "agent-mcp.json");
      fs.writeFileSync(
        agentMcpPath,
        JSON.stringify({
          mcpServers: {
            testServer: { command: "node", args: ["test.js"] }
          }
        }),
        "utf8"
      );
      const customProfilesPath = path.join(testDir, "custom-agents.json");
      process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
      saveCustomAgent("mock-agent", {
        name: "Mock Agent",
        mcpConfig: { paths: [agentMcpPath], key: "mcpServers" },
        skills: null
      });
    };

    it("shareCommand fails fast in non-interactive mode when sharing to repository without authentication", async () => {
      setupMockAgentWithServer();

      let loggedError = "";
      const errSpy = spyOn(console, "error").mockImplementation((msg?: any) => {
        loggedError = String(msg);
      });

      try {
        await shareCommand({
          provider: "repo",
          repo: "octocat/my-repo",
          name: "unauth-pack",
          servers: ["testServer"],
          skills: [],
          plugins: [],
          json: true
        });

        expect(loggedError).toContain("Cannot publish to GitHub repository without authentication");
        const parsed = JSON.parse(loggedError);
        expect(parsed.success).toBe(false);
      } finally {
        errSpy.mockRestore();
      }
    });

    it("shareCommand fails fast in non-interactive mode with diagnostic error when token lacks repo scope", async () => {
      setupMockAgentWithServer();
      saveAuthConfig({ githubToken: "ghp_gist_only_token", githubUser: "octocat" });

      const origVerify = GitHubClient.prototype.verifyUser;
      GitHubClient.prototype.verifyUser = async () => ({
        login: "octocat",
        name: "Octocat",
        scopes: ["gist"],
        hasRepoScope: false,
        hasGistScope: true
      });

      let loggedError = "";
      const errSpy = spyOn(console, "error").mockImplementation((msg?: any) => {
        loggedError = String(msg);
      });

      try {
        await shareCommand({
          provider: "repo",
          repo: "octocat/missing-scope-repo",
          name: "scope-test-pack",
          servers: ["testServer"],
          skills: [],
          plugins: [],
          json: true
        });

        expect(loggedError).toContain("lacks the 'repo' scope required to publish repositories");
        expect(loggedError).toContain("To fix: run 'smcp auth login'");
        const parsed = JSON.parse(loggedError);
        expect(parsed.success).toBe(false);
      } finally {
        GitHubClient.prototype.verifyUser = origVerify;
        errSpy.mockRestore();
      }
    });

    it("shareCommand publishes pack to GitHub repository when authenticated with repo scope", async () => {
      setupMockAgentWithServer();
      saveAuthConfig({ githubToken: "ghp_full_token", githubUser: "octocat" });

      const origVerify = GitHubClient.prototype.verifyUser;
      const origCommit = GitHubClient.prototype.commitFilesToRepo;

      let committedPayload: any = null;

      GitHubClient.prototype.verifyUser = async () => ({
        login: "octocat",
        name: "Octocat",
        scopes: ["gist", "repo"],
        hasRepoScope: true,
        hasGistScope: true
      });

      GitHubClient.prototype.commitFilesToRepo = async (params) => {
        committedPayload = params;
        return {
          commitSha: "sha123456",
          html_url: `https://github.com/${params.owner}/${params.repo}`,
          branch: params.branch || "main"
        };
      };

      let loggedOutput = "";
      const logSpy = spyOn(console, "log").mockImplementation((msg?: any) => {
        loggedOutput = String(msg);
      });

      try {
        await shareCommand({
          provider: "repo",
          repo: "octocat/my-new-repo",
          name: "repo-pack",
          description: "A pack in a repository",
          branch: "main",
          servers: ["testServer"],
          skills: [],
          plugins: [],
          public: true,
          json: true
        });

        expect(committedPayload).toBeDefined();
        expect(committedPayload.owner).toBe("octocat");
        expect(committedPayload.repo).toBe("my-new-repo");
        expect(committedPayload.branch).toBe("main");
        expect(committedPayload.files["smcp.json"]).toBeDefined();
        expect(committedPayload.files["README.md"]).toBeDefined();
        expect(committedPayload.files["README.md"]).toContain("# repo-pack");

        const parsedOutput = JSON.parse(loggedOutput);
        expect(parsedOutput.success).toBe(true);
        expect(parsedOutput.type).toBe("repo");
        expect(parsedOutput.provider).toBe("repo");
        expect(parsedOutput.repo).toBe("octocat/my-new-repo");
        expect(parsedOutput.commit).toBe("sha123456");

        // Verify share history was recorded with targetType: "repo"
        const history = getSharesHistory();
        const rec = history.shares.find((s) => s.name === "repo-pack");
        expect(rec).toBeDefined();
        expect(rec?.targetType).toBe("repo");
        expect(rec?.repoFullName).toBe("octocat/my-new-repo");
        expect(rec?.targetUrl).toBe("https://github.com/octocat/my-new-repo");
      } finally {
        GitHubClient.prototype.verifyUser = origVerify;
        GitHubClient.prototype.commitFilesToRepo = origCommit;
        logSpy.mockRestore();
      }
    });

    it("shareCommand bumps version and preserves repo details when updating existing repo pack", async () => {
      setupMockAgentWithServer();
      saveAuthConfig({ githubToken: "ghp_full_token", githubUser: "octocat" });

      // Pre-seed share history
      recordShare({
        name: "existing-repo-pack",
        version: "1.0.4",
        targetType: "repo",
        targetUrl: "https://github.com/octocat/existing-repo-pack",
        repoFullName: "octocat/existing-repo-pack",
        lastSharedAt: new Date().toISOString(),
        fingerprints: { mcpServers: {}, skills: {} }
      });

      const origVerify = GitHubClient.prototype.verifyUser;
      const origCommit = GitHubClient.prototype.commitFilesToRepo;

      let committedMessage = "";

      GitHubClient.prototype.verifyUser = async () => ({
        login: "octocat",
        name: "Octocat",
        scopes: ["repo"],
        hasRepoScope: true
      });

      GitHubClient.prototype.commitFilesToRepo = async (params) => {
        committedMessage = params.message;
        return {
          commitSha: "sha987654",
          html_url: `https://github.com/${params.owner}/${params.repo}`,
          branch: "main"
        };
      };

      try {
        await shareCommand({
          provider: "repo",
          name: "existing-repo-pack",
          servers: ["testServer"],
          skills: [],
          plugins: [],
          yes: true,
          json: true
        });

        expect(committedMessage).toContain("v1.0.5");

        const history = getSharesHistory();
        const rec = history.shares.find((s) => s.name === "existing-repo-pack");
        expect(rec?.version).toBe("1.0.5");
        expect(rec?.targetType).toBe("repo");
      } finally {
        GitHubClient.prototype.verifyUser = origVerify;
        GitHubClient.prototype.commitFilesToRepo = origCommit;
      }
    });
  });

  describe("install command helpers & templating", () => {
    it("resolveMcpServerTemplates resolves placeholders in env, args, and url", () => {
      const servers: Record<string, McpServerConfig> = {
        apiServer: {
          command: "node",
          args: ["server.js", "--token", "${SERVER_TOKEN}", "--port", "${PORT}"],
          env: {
            API_KEY: "${API_KEY}",
            SAFE_VAL: "constant"
          },
          url: "https://${HOST}:${PORT}/sse"
        }
      };

      const envValues = {
        SERVER_TOKEN: "tok_abc_123",
        PORT: "8080",
        API_KEY: "key_xyz_789",
        HOST: "example.com"
      };

      const resolved = resolveMcpServerTemplates(servers, envValues);

      expect(resolved.apiServer.args).toEqual(["server.js", "--token", "tok_abc_123", "--port", "8080"]);
      expect(resolved.apiServer.env).toEqual({
        API_KEY: "key_xyz_789",
        SAFE_VAL: "constant"
      });
      expect(resolved.apiServer.url).toBe("https://example.com:8080/sse");
    });

    it("resolveMcpServerTemplates preserves placeholders if env var is missing", () => {
      const servers: Record<string, McpServerConfig> = {
        myServer: {
          args: ["${MISSING_ARG}"],
          env: { KEY: "${MISSING_ENV}" },
          url: "${MISSING_URL}"
        }
      };

      const resolved = resolveMcpServerTemplates(servers, {});

      expect(resolved.myServer.args).toEqual(["${MISSING_ARG}"]);
      expect(resolved.myServer.env?.KEY).toBe("${MISSING_ENV}");
      expect(resolved.myServer.url).toBe("${MISSING_URL}");
    });

    it("extractSkillFiles extracts from skill.files first", () => {
      const skill: SkillEntry = {
        name: "test-skill",
        path: "skills/test-skill/SKILL.md",
        files: {
          "SKILL.md": "# Manifest Content",
          "config.json": "{}"
        }
      };

      const files = extractSkillFiles(skill, {
        "skills_test-skill_SKILL.md": "# Gist Content"
      });

      expect(files["SKILL.md"]).toBe("# Manifest Content");
      expect(files["config.json"]).toBe("{}");
    });

    it("extractSkillFiles extracts from Gist rawFiles if skill.files is absent", () => {
      const skill: SkillEntry = {
        name: "gist-skill",
        path: "skills/gist-skill/SKILL.md"
      };

      const rawFiles = {
        "skills_gist-skill_SKILL.md": "# Gist Skill File",
        "skills_gist-skill_sub_action.sh": "echo action",
        "skills_other-skill_SKILL.md": "# Other Skill",
        "smcp.json": "{}"
      };

      const files = extractSkillFiles(skill, rawFiles);

      expect(files["SKILL.md"]).toBe("# Gist Skill File");
      expect(files["sub_action.sh"]).toBe("echo action");
      expect(files["other-skill"]).toBeUndefined();
    });

    it("extractSkillFiles extracts from local directory when localDir is provided", () => {
      const localPackDir = path.join(testDir, "pack-dir");
      const skillDir = path.join(localPackDir, "skills", "local-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# From Local Dir", "utf8");

      const skill: SkillEntry = {
        name: "local-skill",
        path: "skills/local-skill/SKILL.md"
      };

      const files = extractSkillFiles(skill, undefined, localPackDir);
      expect(files["SKILL.md"]).toBe("# From Local Dir");
    });

    it("extractSkillFiles falls back to default SKILL.md when no files exist", () => {
      const skill: SkillEntry = {
        name: "empty-skill",
        path: "skills/empty-skill/SKILL.md",
        description: "An empty skill description"
      };

      const files = extractSkillFiles(skill);
      expect(files["SKILL.md"]).toContain("# empty-skill");
      expect(files["SKILL.md"]).toContain("An empty skill description");
    });

    it("extractSkillFiles rejects path traversal in rawFiles", () => {
      const skill: SkillEntry = {
        name: "traversal-skill",
        path: "skills/traversal-skill/SKILL.md"
      };

      const rawFiles = {
        "skills_traversal-skill_../../secret.txt": "evil content",
        "skills_traversal-skill_/etc/passwd": "evil content 2",
        "skills_traversal-skill_SKILL.md": "# Valid"
      };

      const files = extractSkillFiles(skill, rawFiles);
      expect(files["SKILL.md"]).toBe("# Valid");
      expect(files["../../secret.txt"]).toBeUndefined();
      expect(files["/etc/passwd"]).toBeUndefined();
    });

    it("extractPluginFiles extracts from plugin.files, rawFiles, and localDir", () => {
      // 1. From plugin.files
      const pluginWithFiles: PluginEntry = {
        name: "obj-plugin",
        files: { "index.ts": "export default 42;" }
      };
      expect(extractPluginFiles(pluginWithFiles)["index.ts"]).toBe("export default 42;");

      // 2. From Gist rawFiles
      const strPlugin = "gist-plugin";
      const rawFiles = {
        "plugins_gist-plugin_tool.ts": "console.log('gist tool');",
        "plugins_other-plugin_tool.ts": "console.log('other tool');"
      };
      const gistFiles = extractPluginFiles(strPlugin, rawFiles);
      expect(gistFiles["tool.ts"]).toBe("console.log('gist tool');");
      expect(gistFiles["other-plugin_tool.ts"]).toBeUndefined();

      // 3. From localDir
      const localPack = path.join(testDir, "local-plugin-pack");
      const localPluginDir = path.join(localPack, "plugins", "local-p");
      fs.mkdirSync(localPluginDir, { recursive: true });
      fs.writeFileSync(path.join(localPluginDir, "run.ts"), "export const run = true;", "utf8");

      const localFiles = extractPluginFiles("local-p", undefined, localPack);
      expect(localFiles["run.ts"]).toBe("export const run = true;");

      // 4. Traversal rejection
      const traversalFiles = {
        "plugins_evil-plugin_../../bad.ts": "bad",
        "plugins_evil-plugin_/bad.ts": "bad",
        "plugins_evil-plugin_good.ts": "good"
      };
      const safeExtracted = extractPluginFiles("evil-plugin", traversalFiles);
      expect(safeExtracted["good.ts"]).toBe("good");
      expect(safeExtracted["../../bad.ts"]).toBeUndefined();
      expect(safeExtracted["/bad.ts"]).toBeUndefined();
    });

    it("installPackIntoAgents installs MCP servers and skill files into agent configs", () => {
      const agentMcpPath = path.join(testDir, "installed-agent-mcp.json");
      const agentSkillsDir = path.join(testDir, "installed-agent-skills");

      fs.writeFileSync(
        agentMcpPath,
        JSON.stringify({
          mcpServers: {
            existingServer: { command: "node", args: ["existing.js"] }
          }
        }),
        "utf8"
      );

      const customProfiles: Record<string, AgentProfile> = {
        "test-target-agent": {
          name: "Test Target Agent",
          mcpConfig: { paths: [agentMcpPath], key: "mcpServers" },
          skills: { paths: [agentSkillsDir] }
        }
      };

      const manifest: Manifest = {
        name: "install-test-pack",
        version: "1.0.0",
        mcpServers: {
          newServer: {
            command: "python",
            args: ["main.py"]
          }
        },
        skills: [
          {
            name: "git-helper",
            path: "skills/git-helper/SKILL.md",
            files: {
              "SKILL.md": "# Git Helper Skill",
              "prompt.txt": "git assistance prompt"
            }
          }
        ],
        requiredEnv: []
      };

      const resolvedServers = {
        newServer: {
          command: "python",
          args: ["main.py"]
        }
      };

      const result = installPackIntoAgents(
        manifest,
        ["test-target-agent"],
        resolvedServers,
        undefined,
        undefined,
        customProfiles
      );

      expect(result.installedMcp).toContain("test-target-agent");
      expect(result.installedSkills).toContain("test-target-agent");

      // Verify MCP config has BOTH existing and new servers
      const mcpContent = JSON.parse(fs.readFileSync(agentMcpPath, "utf8"));
      expect(mcpContent.mcpServers.existingServer).toBeDefined();
      expect(mcpContent.mcpServers.newServer).toBeDefined();

      // Verify skills installed
      expect(
        fs.existsSync(path.join(agentSkillsDir, "git-helper", "SKILL.md"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(agentSkillsDir, "git-helper", "prompt.txt"))
      ).toBe(true);
      expect(
        fs.readFileSync(path.join(agentSkillsDir, "git-helper", "SKILL.md"), "utf8")
      ).toBe("# Git Helper Skill");
    });

    it("installPackIntoAgents installs plugins into array and map agents and respects targetAgent", () => {
      const opencodeConf = path.join(testDir, "agent-opencode.json");
      const claudeConf = path.join(testDir, "agent-claude.json");
      const pluginDir = path.join(testDir, "agent-custom-plugins");

      fs.writeFileSync(opencodeConf, JSON.stringify({ plugin: ["existing-opencode-plugin"] }), "utf8");
      fs.writeFileSync(claudeConf, JSON.stringify({ enabledPlugins: { "existing-claude-plugin": true } }), "utf8");

      const customProfiles: Record<string, AgentProfile> = {
        "test-opencode": {
          name: "Test OpenCode",
          mcpConfig: null,
          skills: null,
          plugins: {
            paths: [opencodeConf],
            key: "plugin",
            format: "array",
            dirPaths: [pluginDir]
          }
        },
        "test-claude": {
          name: "Test Claude",
          mcpConfig: null,
          skills: null,
          plugins: {
            paths: [claudeConf],
            key: "enabledPlugins",
            format: "map"
          }
        }
      };

      const manifest: Manifest = {
        name: "plugin-pack",
        version: "1.0.0",
        mcpServers: {},
        skills: [],
        plugins: [
          {
            name: "opencode-only-plugin",
            targetAgent: "opencode",
            files: { "index.ts": "console.log('opencode tool');" }
          },
          {
            name: "claude-only-plugin",
            targetAgent: "claude-code"
          },
          "shared-plugin"
        ],
        requiredEnv: []
      };

      const result = installPackIntoAgents(
        manifest,
        ["test-opencode", "test-claude"],
        {},
        undefined,
        undefined,
        customProfiles,
        pluginDir
      );

      expect(result.installedPlugins).toContain("test-opencode");
      expect(result.installedPlugins).toContain("test-claude");

      // Verify OpenCode configuration
      const opencodeParsed = JSON.parse(fs.readFileSync(opencodeConf, "utf8"));
      expect(opencodeParsed.plugin).toContain("existing-opencode-plugin");
      expect(opencodeParsed.plugin).toContain("opencode-only-plugin");
      expect(opencodeParsed.plugin).toContain("shared-plugin");
      expect(opencodeParsed.plugin).not.toContain("claude-only-plugin");

      // Verify Claude configuration
      const claudeParsed = JSON.parse(fs.readFileSync(claudeConf, "utf8"));
      expect(claudeParsed.enabledPlugins["existing-claude-plugin"]).toBe(true);
      expect(claudeParsed.enabledPlugins["claude-only-plugin"]).toBe(true);
      expect(claudeParsed.enabledPlugins["shared-plugin"]).toBe(true);
      expect(claudeParsed.enabledPlugins["opencode-only-plugin"]).toBeUndefined();

      // Verify plugin file was installed into pluginDir
      expect(
        fs.existsSync(path.join(pluginDir, "index.ts")) ||
        fs.existsSync(path.join(pluginDir, "opencode-only-plugin", "index.ts"))
      ).toBe(true);
    });

    it("resolveActiveAgentPath returns existing path or falls back to first path", () => {
      expect(resolveActiveAgentPath()).toBeNull();
      expect(resolveActiveAgentPath([])).toBeNull();

      const nonExistent1 = path.join(testDir, "nonexistent1.json");
      const existing = path.join(testDir, "existing.json");
      const nonExistent2 = path.join(testDir, "nonexistent2.json");

      fs.writeFileSync(existing, "{}", "utf8");

      // Picks existing path even when not first
      expect(resolveActiveAgentPath([nonExistent1, existing, nonExistent2])).toBe(existing);

      // Falls back to first path when none exist
      expect(resolveActiveAgentPath([nonExistent1, nonExistent2])).toBe(nonExistent1);
    });

    it("installPackIntoAgents resolves the active existing path when multiple paths are configured", () => {
      const nonexistentMcp = path.join(testDir, "missing-mcp.json");
      const activeMcp = path.join(testDir, "active-mcp.json");
      const nonexistentSkills = path.join(testDir, "missing-skills");
      const activeSkills = path.join(testDir, "active-skills");

      fs.writeFileSync(activeMcp, JSON.stringify({ mcpServers: {} }), "utf8");
      fs.mkdirSync(activeSkills, { recursive: true });

      const customProfiles: Record<string, AgentProfile> = {
        "multi-path-agent": {
          name: "Multi Path Agent",
          mcpConfig: { paths: [nonexistentMcp, activeMcp], key: "mcpServers" },
          skills: { paths: [nonexistentSkills, activeSkills] }
        }
      };

      const manifest: Manifest = {
        name: "test-pack",
        version: "1.0.0",
        mcpServers: {
          testServer: { command: "node", args: ["server.js"] }
        },
        skills: [
          {
            name: "test-skill",
            path: "skills/test-skill/SKILL.md",
            files: { "SKILL.md": "# Test" }
          }
        ],
        requiredEnv: []
      };

      const result = installPackIntoAgents(
        manifest,
        ["multi-path-agent"],
        { testServer: { command: "node", args: ["server.js"] } },
        undefined,
        undefined,
        customProfiles
      );

      expect(result.installedMcp).toContain("multi-path-agent");
      expect(result.installedSkills).toContain("multi-path-agent");

      // First paths should not have been created/written to
      expect(fs.existsSync(nonexistentMcp)).toBe(false);
      expect(fs.existsSync(path.join(nonexistentSkills, "test-skill"))).toBe(false);

      // Active paths should contain the installed configs
      const mcpContent = JSON.parse(fs.readFileSync(activeMcp, "utf8"));
      expect(mcpContent.mcpServers.testServer).toBeDefined();
      expect(fs.existsSync(path.join(activeSkills, "test-skill", "SKILL.md"))).toBe(true);
    });

    it("installCommand installs from local pack directory with options", async () => {
      // 1. Create a pack directory with smcp.json
      const packDir = path.join(testDir, "local-install-source");
      fs.mkdirSync(path.join(packDir, "skills", "sample-skill"), { recursive: true });
      fs.writeFileSync(
        path.join(packDir, "skills", "sample-skill", "SKILL.md"),
        "# Sample Skill\nContent",
        "utf8"
      );

      const manifestData = {
        name: "source-pack",
        version: "1.0.0",
        description: "Local install test",
        mcpServers: {
          remoteApi: {
            url: "https://${API_HOST}/sse",
            env: { AUTH_TOKEN: "${AUTH_TOKEN}" }
          }
        },
        skills: [
          {
            name: "sample-skill",
            path: "skills/sample-skill/SKILL.md",
            files: {
              "SKILL.md": "# Sample Skill\nContent"
            }
          }
        ],
        requiredEnv: [
          { key: "API_HOST", isSecret: false },
          { key: "AUTH_TOKEN", isSecret: true }
        ]
      };
      fs.writeFileSync(
        path.join(packDir, "smcp.json"),
        JSON.stringify(manifestData, null, 2),
        "utf8"
      );

      // 2. Set up target agent
      const targetMcpFile = path.join(testDir, "target-agent.json");
      const targetSkillsDir = path.join(testDir, "target-skills");
      fs.writeFileSync(targetMcpFile, JSON.stringify({ mcpServers: {} }), "utf8");

      const customProfilesPath = path.join(testDir, "custom-agents.json");
      process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
      saveCustomAgent("target-agent", {
        name: "Target Agent",
        mcpConfig: { paths: [targetMcpFile], key: "mcpServers" },
        skills: { paths: [targetSkillsDir] }
      });

      // 3. Run installCommand with non-interactive options
      await installCommand(packDir, {
        agents: ["target-agent"],
        env: {
          API_HOST: "api.mycloud.com",
          AUTH_TOKEN: "supersecrettoken999"
        },
        force: true
      });

      // 4. Verify installation
      const updatedMcp = JSON.parse(fs.readFileSync(targetMcpFile, "utf8"));
      expect(updatedMcp.mcpServers.remoteApi).toBeDefined();
      expect(updatedMcp.mcpServers.remoteApi.url).toBe("https://api.mycloud.com/sse");
      expect(updatedMcp.mcpServers.remoteApi.env.AUTH_TOKEN).toBe("supersecrettoken999");

      expect(
        fs.existsSync(path.join(targetSkillsDir, "sample-skill", "SKILL.md"))
      ).toBe(true);
      expect(
        fs.readFileSync(path.join(targetSkillsDir, "sample-skill", "SKILL.md"), "utf8")
      ).toBe("# Sample Skill\nContent");
    });

    it("installCommand handles Gist fetch and installs cleanly", async () => {
      const origFetchGist = GitHubClient.fetchGist;
      GitHubClient.fetchGist = async () => ({
        id: "gist_test_123",
        html_url: "https://gist.github.com/testuser/gist_test_123",
        files: {
          "smcp.json": {
            content: JSON.stringify({
              name: "gist-pack",
              version: "1.0.0",
              description: "Pack from Gist",
              mcpServers: {
                gistServer: {
                  command: "node",
                  args: ["index.js", "${OPT_FLAG}"]
                }
              },
              skills: [
                {
                  name: "gist-skill",
                  path: "skills/gist-skill/SKILL.md"
                }
              ]
            })
          },
          "skills_gist-skill_SKILL.md": {
            content: "# Skill from Gist"
          }
        }
      });

      const targetMcp = path.join(testDir, "gist-target-mcp.json");
      const targetSkills = path.join(testDir, "gist-target-skills");
      fs.writeFileSync(targetMcp, JSON.stringify({ mcpServers: {} }), "utf8");

      const customProfilesPath = path.join(testDir, "custom-agents.json");
      process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
      saveCustomAgent("gist-agent", {
        name: "Gist Agent",
        mcpConfig: { paths: [targetMcp], key: "mcpServers" },
        skills: { paths: [targetSkills] }
      });

      try {
        await installCommand("https://gist.github.com/testuser/gist_test_123", {
          agents: ["gist-agent"],
          env: { OPT_FLAG: "--verbose" },
          force: true
        });

        const mcp = JSON.parse(fs.readFileSync(targetMcp, "utf8"));
        expect(mcp.mcpServers.gistServer).toBeDefined();
        expect(mcp.mcpServers.gistServer.args).toEqual(["index.js", "--verbose"]);

        expect(
          fs.readFileSync(path.join(targetSkills, "gist-skill", "SKILL.md"), "utf8")
        ).toBe("# Skill from Gist");
      } finally {
        GitHubClient.fetchGist = origFetchGist;
      }
    });

    it("installCommand prompts and aborts if conflict exists and user declines overwrite", async () => {
      const packDir = path.join(testDir, "conflict-source");
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(
        path.join(packDir, "smcp.json"),
        JSON.stringify({
          name: "conflict-pack",
          version: "1.0.0",
          mcpServers: {
            duplicateServer: { command: "node", args: ["new-version.js"] }
          }
        }),
        "utf8"
      );

      const targetMcp = path.join(testDir, "conflict-target-mcp.json");
      fs.writeFileSync(
        targetMcp,
        JSON.stringify({
          mcpServers: {
            duplicateServer: { command: "node", args: ["old-version.js"] }
          }
        }),
        "utf8"
      );

      const customProfilesPath = path.join(testDir, "custom-agents.json");
      process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
      saveCustomAgent("conflict-agent", {
        name: "Conflict Agent",
        mcpConfig: { paths: [targetMcp], key: "mcpServers" },
        skills: null
      });

      const confirmSpy = spyOn(p, "confirm").mockImplementation((async () => false) as any);
      let cancelMsg = "";
      const cancelSpy = spyOn(p, "cancel").mockImplementation(((msg?: string) => {
        cancelMsg = msg || "";
      }) as any);

      try {
        await installCommand(packDir, {
          agents: ["conflict-agent"]
        });

        expect(cancelMsg).toContain("cancelled");
        // Verify original server was NOT overwritten
        const mcp = JSON.parse(fs.readFileSync(targetMcp, "utf8"));
        expect(mcp.mcpServers.duplicateServer.args).toEqual(["old-version.js"]);
      } finally {
        confirmSpy.mockRestore();
        cancelSpy.mockRestore();
      }
    });

    it("installCommand prompts and proceeds if conflict exists and user confirms overwrite", async () => {
      const packDir = path.join(testDir, "conflict-overwrite-source");
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(
        path.join(packDir, "smcp.json"),
        JSON.stringify({
          name: "conflict-overwrite-pack",
          version: "1.0.0",
          mcpServers: {
            duplicateServer: { command: "node", args: ["new-version.js"] }
          }
        }),
        "utf8"
      );

      const targetMcp = path.join(testDir, "conflict-overwrite-target-mcp.json");
      fs.writeFileSync(
        targetMcp,
        JSON.stringify({
          mcpServers: {
            duplicateServer: { command: "node", args: ["old-version.js"] }
          }
        }),
        "utf8"
      );

      const customProfilesPath = path.join(testDir, "custom-agents.json");
      process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
      saveCustomAgent("conflict-agent-2", {
        name: "Conflict Agent 2",
        mcpConfig: { paths: [targetMcp], key: "mcpServers" },
        skills: null
      });

      const confirmSpy = spyOn(p, "confirm").mockImplementation((async () => true) as any);

      try {
        await installCommand(packDir, {
          agents: ["conflict-agent-2"]
        });

        // Verify server was successfully updated
        const mcp = JSON.parse(fs.readFileSync(targetMcp, "utf8"));
        expect(mcp.mcpServers.duplicateServer.args).toEqual(["new-version.js"]);
      } finally {
        confirmSpy.mockRestore();
      }
    });

    it("installCommand conflict check inspects the active existing config path when multiple paths exist", async () => {
      const packDir = path.join(testDir, "conflict-multipath-pack");
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(
        path.join(packDir, "smcp.json"),
        JSON.stringify({
          name: "conflict-multipath-pack",
          version: "1.0.0",
          mcpServers: {
            sharedServer: { command: "node", args: ["new.js"] }
          }
        }),
        "utf8"
      );

      const nonexistentMcp = path.join(testDir, "missing-before-mcp.json");
      const activeMcp = path.join(testDir, "active-conflict-mcp.json");
      fs.writeFileSync(
        activeMcp,
        JSON.stringify({
          mcpServers: {
            sharedServer: { command: "node", args: ["old.js"] }
          }
        }),
        "utf8"
      );

      const customProfilesPath = path.join(testDir, "custom-agents.json");
      process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
      saveCustomAgent("multipath-conflict-agent", {
        name: "Multipath Conflict Agent",
        mcpConfig: { paths: [nonexistentMcp, activeMcp], key: "mcpServers" },
        skills: null
      });

      let promptShown = false;
      const confirmSpy = spyOn(p, "confirm").mockImplementation((async () => {
        promptShown = true;
        return false; // abort
      }) as any);
      const cancelSpy = spyOn(p, "cancel").mockImplementation((() => {}) as any);

      try {
        await installCommand(packDir, {
          agents: ["multipath-conflict-agent"]
        });
        expect(promptShown).toBe(true);
      } finally {
        confirmSpy.mockRestore();
        cancelSpy.mockRestore();
      }
    });

    it("installCommand installs plugins and writes plugin scripts to custom pluginDir", async () => {
      const packDir = path.join(testDir, "pack-with-plugins");
      const packPluginDir = path.join(packDir, "plugins", "my-tool");
      fs.mkdirSync(packPluginDir, { recursive: true });
      fs.writeFileSync(path.join(packPluginDir, "index.ts"), "console.log('installed tool');", "utf8");

      fs.writeFileSync(
        path.join(packDir, "smcp.json"),
        JSON.stringify({
          name: "pack-with-plugins",
          version: "1.0.0",
          mcpServers: {},
          skills: [],
          plugins: [
            {
              name: "my-tool",
              targetAgent: "opencode"
            }
          ],
          requiredEnv: []
        }),
        "utf8"
      );

      const opencodeConf = path.join(testDir, "dest-opencode.json");
      fs.writeFileSync(opencodeConf, JSON.stringify({ plugin: [] }), "utf8");

      const destPluginDir = path.join(testDir, "custom-installed-plugins");

      const customProfilesPath = path.join(testDir, "custom-agents.json");
      process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
      saveCustomAgent("plugin-dest-agent", {
        name: "Plugin Dest Agent",
        mcpConfig: null,
        skills: null,
        plugins: {
          paths: [opencodeConf],
          key: "plugin",
          format: "array"
        }
      });

      await installCommand(packDir, {
        agents: ["plugin-dest-agent"],
        pluginDir: destPluginDir,
        force: true
      });

      const updatedConf = JSON.parse(fs.readFileSync(opencodeConf, "utf8"));
      expect(updatedConf.plugin).toContain("my-tool");

      expect(
        fs.existsSync(path.join(destPluginDir, "index.ts")) ||
        fs.existsSync(path.join(destPluginDir, "my-tool", "index.ts"))
      ).toBe(true);
    });
  });
});
