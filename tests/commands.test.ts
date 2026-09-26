import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as p from "@clack/prompts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentAddCommand, agentListCommand } from "../src/commands/agent.ts";
import { authLoginCommand, authLogoutCommand, authStatusCommand } from "../src/commands/auth.ts";
import {
  extractSkillFiles,
  installCommand,
  installPackIntoAgents,
  resolveMcpServerTemplates
} from "../src/commands/install.ts";
import { listCommand } from "../src/commands/list.ts";
import { bundleSkillFiles, exportPackLocally, shareCommand } from "../src/commands/share.ts";
import { getAgentProfiles, saveCustomAgent } from "../src/core/agents.ts";
import { GitHubClient } from "../src/core/github.ts";
import { clearAuthConfig, getAuthConfig, getSharesHistory, saveAuthConfig } from "../src/core/state.ts";
import type { AgentProfile, Manifest, McpServerConfig, SkillEntry } from "../src/types.ts";

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
        "~/.custom/skills" // skillsPath
      ];

      const textSpy = spyOn(p, "text").mockImplementation((async () => answers[promptIndex++]) as any);

      try {
        await agentAddCommand();

        const profiles = getAgentProfiles();
        expect(profiles["custom-test-agent"]).toBeDefined();
        expect(profiles["custom-test-agent"].name).toBe("Custom Test Agent");
        expect(profiles["custom-test-agent"].mcpConfig?.paths).toEqual(["~/.custom/mcp.json"]);
        expect(profiles["custom-test-agent"].skills?.paths).toEqual(["~/.custom/skills"]);
      } finally {
        textSpy.mockRestore();
      }
    });
  });

  describe("list command", () => {
    it("listCommand runs without throwing when no agents are detected", () => {
      expect(() => listCommand()).not.toThrow();
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
      expect(manifest.requiredEnv.some((r) => r.key === "API_KEY")).toBe(true);

      // Verify share recorded in history
      const history = getSharesHistory();
      const rec = history.shares.find((s) => s.name === "my-shared-pack");
      expect(rec).toBeDefined();
      expect(rec?.targetType).toBe("local");
      expect(rec?.targetUrl).toBe(path.resolve(outDir));
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
  });
});
