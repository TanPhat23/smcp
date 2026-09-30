import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as p from "@clack/prompts";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProgram } from "../packages/cli/src/cli.ts";
import { inspectCommand } from "../packages/cli/src/commands/inspect.ts";
import { GitHubClient } from "../packages/core/src/core/github.ts";
import type { Manifest } from "../packages/core/src/types/index.ts";

describe("CLI Commander Wiring & Inspect Command", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-cli-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("createProgram() structure", () => {
    it("configures program name, version, and description", () => {
      const program = createProgram();
      expect(program.name()).toBe("smcp");
      expect(program.version()).toBe("0.1.6");
      expect(program.description()).toContain("AI Agent Skills and MCP");
    });

    it("configures --no-plugins and --no-extensions root options", () => {
      const program = createProgram();
      const options = program.options.map((o) => o.flags);
      expect(options.some((f) => f.includes("--no-plugins"))).toBe(true);
      expect(options.some((f) => f.includes("--no-extensions"))).toBe(true);
    });

    it("wires up share command with export alias and options", () => {
      const program = createProgram();
      const shareCmd = program.commands.find((c) => c.name() === "share");
      expect(shareCmd).toBeDefined();
      expect(shareCmd?.aliases()).toContain("export");

      const options = shareCmd?.options.map((o) => o.flags) || [];
      expect(options.some((f) => f.includes("-P") && f.includes("--provider"))).toBe(true);
      expect(options.some((f) => f.includes("-R") && f.includes("--repo"))).toBe(true);
      expect(options.some((f) => f.includes("--branch"))).toBe(true);
      expect(options.some((f) => f.includes("-o") && f.includes("--output"))).toBe(true);
      expect(options.some((f) => f.includes("-a") && f.includes("--agents"))).toBe(true);
      expect(options.some((f) => f.includes("-s") && f.includes("--servers"))).toBe(true);
      expect(options.some((f) => f.includes("-k") && f.includes("--skills"))).toBe(true);
      expect(options.some((f) => f.includes("-p") && f.includes("--plugins"))).toBe(true);
    });

    it("wires up install command with add alias and options", () => {
      const program = createProgram();
      const installCmd = program.commands.find((c) => c.name() === "install");
      expect(installCmd).toBeDefined();
      expect(installCmd?.aliases()).toContain("add");

      const options = installCmd?.options.map((o) => o.flags) || [];
      expect(options.some((f) => f.includes("-a") && f.includes("--agents"))).toBe(true);
      expect(options.some((f) => f.includes("-f") && f.includes("--force"))).toBe(true);
      expect(options.some((f) => f.includes("--plugin-dir"))).toBe(true);
    });

    it("wires up inspect command with info alias", () => {
      const program = createProgram();
      const inspectCmd = program.commands.find((c) => c.name() === "inspect");
      expect(inspectCmd).toBeDefined();
      expect(inspectCmd?.aliases()).toContain("info");
    });

    it("wires up list command with ls alias and options", () => {
      const program = createProgram();
      const listCmd = program.commands.find((c) => c.name() === "list");
      expect(listCmd).toBeDefined();
      expect(listCmd?.aliases()).toContain("ls");

      const options = listCmd?.options.map((o) => o.flags) || [];
      expect(options.some((f) => f.includes("-a") && f.includes("--agents"))).toBe(true);
      expect(options.some((f) => f.includes("-s") && f.includes("--settings"))).toBe(true);
      expect(options.some((f) => f.includes("-v") && f.includes("--verbose"))).toBe(true);
    });

    it("wires up auth subcommands (login, logout, status)", () => {
      const program = createProgram();
      const authCmd = program.commands.find((c) => c.name() === "auth");
      expect(authCmd).toBeDefined();

      const subcommands = authCmd?.commands.map((c) => c.name()) || [];
      expect(subcommands).toContain("login");
      expect(subcommands).toContain("logout");
      expect(subcommands).toContain("status");
    });

    it("wires up agent subcommands (list with ls alias, add, install-skill)", () => {
      const program = createProgram();
      const agentCmd = program.commands.find((c) => c.name() === "agent");
      expect(agentCmd).toBeDefined();

      const subcommands = agentCmd?.commands.map((c) => c.name()) || [];
      expect(subcommands).toContain("list");
      expect(subcommands).toContain("add");
      expect(subcommands).toContain("install-skill");

      const listSub = agentCmd?.commands.find((c) => c.name() === "list");
      expect(listSub?.aliases()).toContain("ls");
    });

    it("wires up instructions command with usage alias", () => {
      const program = createProgram();
      const instCmd = program.commands.find((c) => c.name() === "instructions");
      expect(instCmd).toBeDefined();
      expect(instCmd?.aliases()).toContain("usage");

      const options = instCmd?.options.map((o) => o.flags) || [];
      expect(options.some((f) => f.includes("--json"))).toBe(true);
    });
  });

  describe("inspectCommand()", () => {
    it("inspects a local pack directory and returns manifest", async () => {
      const manifest: Manifest = {
        $schema: "https://smcp.dev/schema.json",
        name: "test-pack",
        version: "1.0.0",
        description: "Test pack description",
        mcpServers: {
          myServer: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            env: {
              API_KEY: "${API_KEY}"
            }
          }
        },
        skills: [
          {
            name: "test-skill",
            path: "skills/test-skill/SKILL.md",
            description: "Test skill description",
            files: {
              "SKILL.md": "# Test Skill"
            }
          }
        ],
        requiredEnv: [
          {
            key: "API_KEY",
            description: "API Key credential",
            isSecret: true
          }
        ]
      };

      fs.writeFileSync(path.join(testDir, "smcp.json"), JSON.stringify(manifest, null, 2), "utf8");

      const result = await inspectCommand(testDir);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("test-pack");
      expect(result?.version).toBe("1.0.0");
      expect(result?.description).toBe("Test pack description");
      expect(Object.keys(result?.mcpServers || {})).toContain("myServer");
      expect(result?.skills?.[0].name).toBe("test-skill");
    });

    it("inspects a direct smcp.json file path", async () => {
      const manifest: Manifest = {
        name: "file-pack",
        version: "2.1.0",
        description: "Direct file inspection test",
        mcpServers: {},
        skills: [],
        requiredEnv: []
      };

      const filePath = path.join(testDir, "custom-pack.json");
      fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf8");

      const result = await inspectCommand(filePath);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("file-pack");
      expect(result?.version).toBe("2.1.0");
    });

    it("scans templated placeholders from mcpServers and includes them in inspection", async () => {
      const manifest: Manifest = {
        name: "templated-pack",
        version: "1.0.0",
        mcpServers: {
          databaseServer: {
            command: "npx",
            args: ["--url", "${DB_URL}"],
            env: {
              DB_SECRET: "${DB_PASSWORD}"
            }
          }
        },
        skills: [],
        requiredEnv: []
      };

      fs.writeFileSync(path.join(testDir, "smcp.json"), JSON.stringify(manifest, null, 2), "utf8");

      const result = await inspectCommand(testDir);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("templated-pack");
    });

    it("returns null when source does not exist", async () => {
      const result = await inspectCommand("/non/existent/path/here");
      expect(result).toBeNull();
    });

    it("returns null when source is empty", async () => {
      const result = await inspectCommand("   ");
      expect(result).toBeNull();
    });

    it("inspects a Gist source via mocked GitHubClient", async () => {
      const manifestContent = JSON.stringify({
        name: "gist-pack",
        version: "1.0.0",
        description: "Pack hosted on Gist",
        mcpServers: {},
        skills: [
          {
            name: "gist-skill",
            path: "skills/gist-skill/SKILL.md",
            description: "Gist skill"
          }
        ],
        requiredEnv: []
      });

      const spy = spyOn(GitHubClient, "fetchGist").mockResolvedValue({
        id: "abcdef1234567890abcdef1234567890",
        html_url: "https://gist.github.com/testuser/abcdef1234567890abcdef1234567890",
        files: {
          "smcp.json": {
            filename: "smcp.json",
            content: manifestContent
          }
        }
      });

      try {
        const result = await inspectCommand("https://gist.github.com/testuser/abcdef1234567890abcdef1234567890");
        expect(result).not.toBeNull();
        expect(result?.name).toBe("gist-pack");
        expect(result?.skills?.[0].name).toBe("gist-skill");
      } finally {
        spy.mockRestore();
      }
    });

    it("handles shareCommand with agents option filtering", async () => {
      const { shareCommand } = await import("../packages/cli/src/commands/share/index.ts");
      let cancelMsg = "";
      const spyCancel = spyOn(p, "cancel").mockImplementation((msg: any) => {
        cancelMsg = String(msg);
      });

      try {
        await shareCommand({
          output: path.join(testDir, "filtered-share-out"),
          agents: ["non-existent-agent-id-999"]
        });
        expect(cancelMsg).toContain("No supported AI agents found");
      } finally {
        spyCancel.mockRestore();
      }
    });
  });

  describe("Executable bin/smcp.js & build output", () => {
    const smcpRoot = path.resolve(__dirname, "..");
    const binSmcp = path.join(smcpRoot, "bin", "smcp.js");

    it("runs node bin/smcp.js --help and exits 0", () => {
      const output = execSync(`node "${binSmcp}" --help`, {
        cwd: smcpRoot,
        encoding: "utf8"
      });
      expect(output).toContain("Usage: smcp [options] [command]");
      expect(output).toContain("share|export");
      expect(output).toContain("install|add");
      expect(output).toContain("inspect|info");
      expect(output).toContain("list|ls");
      expect(output).toContain("auth");
      expect(output).toContain("agent");
    });

    it("runs node bin/smcp.js --version and outputs 0.1.6", () => {
      const output = execSync(`node "${binSmcp}" --version`, {
        cwd: smcpRoot,
        encoding: "utf8"
      });
      expect(output.trim()).toBe("0.1.6");
    });

    it("runs bun bin/smcp.js --help and exits 0", () => {
      const output = execSync(`bun "${binSmcp}" --help`, {
        cwd: smcpRoot,
        encoding: "utf8"
      });
      expect(output).toContain("Usage: smcp [options] [command]");
    });

    it("imports dist/cli.js in Node.js ESM without process side effects", () => {
      const distCliPath = path.join(smcpRoot, "packages/cli/dist/cli.js");
      if (fs.existsSync(distCliPath)) {
        const output = execSync(
          `node -e 'import("${distCliPath}").then((m) => console.log("IMPORTED:" + typeof m.runCli))'`,
          {
            cwd: smcpRoot,
            encoding: "utf8"
          }
        );
        expect(output.trim()).toBe("IMPORTED:function");
      }
    });

    it("executes end-to-end export, inspect, and install workflow via CLI binary", () => {
      const e2eDir = path.join(testDir, "e2e-workflow");
      const srcEnv = path.join(e2eDir, "src-env");
      const targetEnv = path.join(e2eDir, "target-env");
      const packDir = path.join(e2eDir, "exported-pack");

      fs.mkdirSync(path.join(srcEnv, ".opencode", "skills", "e2e-skill"), { recursive: true });
      fs.mkdirSync(path.join(targetEnv, ".opencode", "skills"), { recursive: true });

      // Create source OpenCode config and skill
      fs.writeFileSync(
        path.join(srcEnv, "opencode.json"),
        JSON.stringify({
          mcpServers: {
            "e2e-postgres": {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass123@localhost:5432/mydb"],
              env: { API_KEY: "sk-test12345678901234567890", APP_ENV: "production" }
            }
          }
        }),
        "utf8"
      );
      fs.writeFileSync(
        path.join(srcEnv, ".opencode", "skills", "e2e-skill", "SKILL.md"),
        "# E2E Skill\nSkill documentation.\n",
        "utf8"
      );

      const isolatedSmcpDir = path.join(e2eDir, "smcp-state");

      // 1. Export pack using CLI binary
      const exportOutput = execSync(
        `node "${binSmcp}" share -o "${packDir}" -s e2e-postgres -k e2e-skill`,
        {
          cwd: srcEnv,
          encoding: "utf8",
          env: {
            ...process.env,
            SMCP_DIR: isolatedSmcpDir
          }
        }
      );
      expect(exportOutput).toContain("Pack successfully exported");

      // Verify smcp.json manifest and redaction
      const manifestPath = path.join(packDir, "smcp.json");
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.name).toBe("my-agent-pack");
      expect(manifest.mcpServers["e2e-postgres"].args[2]).toBe("${E2E_POSTGRES_DATABASE_URL}");
      expect(manifest.mcpServers["e2e-postgres"].env.API_KEY).toBe("${API_KEY}");
      expect(manifest.mcpServers["e2e-postgres"].env.APP_ENV).toBe("production");
      expect(manifest.requiredEnv.some((r: any) => r.key === "API_KEY" && r.isSecret)).toBe(true);
      expect(manifest.requiredEnv.some((r: any) => r.key === "E2E_POSTGRES_DATABASE_URL" && r.isSecret)).toBe(true);

      // 2. Inspect pack using CLI binary
      const inspectOutput = execSync(`node "${binSmcp}" inspect "${packDir}"`, {
        cwd: smcpRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SMCP_DIR: isolatedSmcpDir
        }
      });
      expect(inspectOutput).toContain("my-agent-pack");
      expect(inspectOutput).toContain("API_KEY");
      expect(inspectOutput).toContain("e2e-postgres");
      expect(inspectOutput).toContain("e2e-skill");

      // 3. Install pack into target environment using CLI binary
      fs.writeFileSync(
        path.join(targetEnv, "opencode.json"),
        JSON.stringify({ mcpServers: { existingServer: { command: "echo", args: ["ready"] } } }),
        "utf8"
      );

      const installOutput = execSync(
        `node "${binSmcp}" install "${packDir}" -a opencode -f`,
        {
          cwd: targetEnv,
          encoding: "utf8",
          env: {
            ...process.env,
            SMCP_DIR: isolatedSmcpDir,
            API_KEY: "real-prod-api-key",
            E2E_POSTGRES_DATABASE_URL: "postgresql://prod:secret@cluster:5432/live"
          }
        }
      );
      expect(installOutput).toContain("Installation completed");

      // 4. Verify target configuration and installed files
      const targetConfig = JSON.parse(fs.readFileSync(path.join(targetEnv, "opencode.json"), "utf8"));
      const servers = targetConfig.mcp?.servers || targetConfig.mcpServers;
      expect(servers.existingServer).toBeDefined();
      expect(servers["e2e-postgres"]).toBeDefined();
      const postgres = servers["e2e-postgres"];
      const postgresArgs = Array.isArray(postgres.command) ? postgres.command : postgres.args;
      expect(postgresArgs.some((a: string) => a.includes("postgresql://prod:secret@cluster:5432/live"))).toBe(true);
      const postgresEnv = postgres.environment || postgres.env;
      expect(postgresEnv.API_KEY).toBe("real-prod-api-key");
      expect(postgresEnv.APP_ENV).toBe("production");

      const installedSkillDoc = fs.readFileSync(
        path.join(targetEnv, ".opencode", "skills", "e2e-skill", "SKILL.md"),
        "utf8"
      );
      expect(installedSkillDoc).toContain("# E2E Skill");
    });

    it("executes end-to-end export, inspect, and install workflow for plugins via CLI binary", () => {
      const e2eDir = path.join(testDir, "e2e-plugin-workflow");
      const srcEnv = path.join(e2eDir, "src-env");
      const targetEnv = path.join(e2eDir, "target-env");
      const packDir = path.join(e2eDir, "exported-plugin-pack");

      fs.mkdirSync(path.join(srcEnv, "plugin"), { recursive: true });
      fs.mkdirSync(targetEnv, { recursive: true });

      // Create source OpenCode config and plugin file
      fs.writeFileSync(
        path.join(srcEnv, "opencode.json"),
        JSON.stringify({
          plugin: ["opencode-gemini-auth@latest", "./plugin/custom-tool.ts"]
        }),
        "utf8"
      );
      fs.writeFileSync(
        path.join(srcEnv, "plugin", "custom-tool.ts"),
        "export default { name: 'custom-tool' };\n",
        "utf8"
      );

      const isolatedSmcpDir = path.join(e2eDir, "smcp-state");

      // 1. Export pack with plugins
      const exportOutput = execSync(
        `node "${binSmcp}" share -o "${packDir}" -p opencode-gemini-auth@latest -p ./plugin/custom-tool.ts -y`,
        {
          cwd: srcEnv,
          encoding: "utf8",
          env: {
            ...process.env,
            SMCP_DIR: isolatedSmcpDir
          }
        }
      );
      expect(exportOutput).toContain("Pack successfully exported");

      // Verify smcp.json manifest contains plugins
      const manifestPath = path.join(packDir, "smcp.json");
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.plugins).toBeDefined();
      expect(manifest.plugins.some((p: any) => (typeof p === "string" ? p : p.name).includes("opencode-gemini-auth"))).toBe(true);
      expect(manifest.plugins.some((p: any) => (typeof p === "string" ? p : p.name).includes("custom-tool"))).toBe(true);

      // 2. Inspect pack via CLI
      const inspectJson = execSync(`node "${binSmcp}" inspect "${packDir}" --json`, {
        cwd: smcpRoot,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          SMCP_DIR: isolatedSmcpDir
        }
      });
      const parsedInspect = JSON.parse(inspectJson);
      expect(parsedInspect.manifest.plugins).toBeDefined();
      expect(parsedInspect.manifest.plugins.length).toBeGreaterThanOrEqual(1);

      // 3. Install pack into target environment with custom plugin directory
      fs.writeFileSync(
        path.join(targetEnv, "opencode.json"),
        JSON.stringify({ plugin: ["existing-plugin"] }),
        "utf8"
      );

      const targetCustomPluginDir = path.join(targetEnv, "installed-plugins");

      const installOutput = execSync(
        `node "${binSmcp}" install "${packDir}" -a opencode --plugin-dir "${targetCustomPluginDir}" -f -y --json`,
        {
          cwd: targetEnv,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            SMCP_DIR: isolatedSmcpDir,
            CONTEXT7_API_KEY: "test-ctx7-key"
          }
        }
      );
      const parsedInstall = JSON.parse(installOutput);
      expect(parsedInstall.success).toBe(true);
      expect(parsedInstall.installedPlugins).toBeDefined();

      // 4. Verify target environment config and installed plugin files
      const targetConfig = JSON.parse(fs.readFileSync(path.join(targetEnv, "opencode.json"), "utf8"));
      const pluginsList = targetConfig.plugins || targetConfig.plugin;
      expect(pluginsList).toContain("existing-plugin");
      expect(pluginsList.some((p: string) => p.includes("opencode-gemini-auth"))).toBe(true);
      // In OpenCode V2, direct .ts file paths are omitted from plugins array to prevent v2.0.20 rejection
      expect(pluginsList.some((p: string) => p.endsWith(".ts"))).toBe(false);

      expect(
        fs.existsSync(path.join(targetCustomPluginDir, "custom-tool.ts")) ||
        fs.existsSync(path.join(targetCustomPluginDir, "custom-tool", "custom-tool.ts")) ||
        fs.existsSync(path.join(targetCustomPluginDir, "index.ts"))
      ).toBe(true);
    });
  });
});
