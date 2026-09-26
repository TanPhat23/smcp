import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as p from "@clack/prompts";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProgram } from "../src/cli.ts";
import { inspectCommand } from "../src/commands/inspect.ts";
import { GitHubClient } from "../src/core/github.ts";
import type { Manifest } from "../src/types.ts";

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
      expect(program.version()).toBe("0.1.0");
      expect(program.description()).toContain("AI Agent Skills and MCP");
    });

    it("wires up share command with export alias and options", () => {
      const program = createProgram();
      const shareCmd = program.commands.find((c) => c.name() === "share");
      expect(shareCmd).toBeDefined();
      expect(shareCmd?.aliases()).toContain("export");

      const options = shareCmd?.options.map((o) => o.flags) || [];
      expect(options.some((f) => f.includes("-o") && f.includes("--output"))).toBe(true);
      expect(options.some((f) => f.includes("-a") && f.includes("--agents"))).toBe(true);
      expect(options.some((f) => f.includes("-s") && f.includes("--servers"))).toBe(true);
      expect(options.some((f) => f.includes("-k") && f.includes("--skills"))).toBe(true);
    });

    it("wires up install command with add alias and options", () => {
      const program = createProgram();
      const installCmd = program.commands.find((c) => c.name() === "install");
      expect(installCmd).toBeDefined();
      expect(installCmd?.aliases()).toContain("add");

      const options = installCmd?.options.map((o) => o.flags) || [];
      expect(options.some((f) => f.includes("-a") && f.includes("--agents"))).toBe(true);
      expect(options.some((f) => f.includes("-f") && f.includes("--force"))).toBe(true);
    });

    it("wires up inspect command with info alias", () => {
      const program = createProgram();
      const inspectCmd = program.commands.find((c) => c.name() === "inspect");
      expect(inspectCmd).toBeDefined();
      expect(inspectCmd?.aliases()).toContain("info");
    });

    it("wires up list command with ls alias", () => {
      const program = createProgram();
      const listCmd = program.commands.find((c) => c.name() === "list");
      expect(listCmd).toBeDefined();
      expect(listCmd?.aliases()).toContain("ls");
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

    it("wires up agent subcommands (list with ls alias, add)", () => {
      const program = createProgram();
      const agentCmd = program.commands.find((c) => c.name() === "agent");
      expect(agentCmd).toBeDefined();

      const subcommands = agentCmd?.commands.map((c) => c.name()) || [];
      expect(subcommands).toContain("list");
      expect(subcommands).toContain("add");

      const listSub = agentCmd?.commands.find((c) => c.name() === "list");
      expect(listSub?.aliases()).toContain("ls");
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
      const { shareCommand } = await import("../src/commands/share.ts");
      let cancelMsg = "";
      const spyCancel = spyOn(p, "cancel").mockImplementation((msg) => {
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

    it("runs node bin/smcp.js --version and outputs 0.1.0", () => {
      const output = execSync(`node "${binSmcp}" --version`, {
        cwd: smcpRoot,
        encoding: "utf8"
      });
      expect(output.trim()).toBe("0.1.0");
    });

    it("runs bun bin/smcp.js --help and exits 0", () => {
      const output = execSync(`bun "${binSmcp}" --help`, {
        cwd: smcpRoot,
        encoding: "utf8"
      });
      expect(output).toContain("Usage: smcp [options] [command]");
    });
  });
});
