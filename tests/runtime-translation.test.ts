import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_AGENTS,
  detectAvailableRuntime,
  transformMcpServerRuntime,
  type AgentProfile,
  type Manifest,
  type McpServerConfig
} from "../packages/core/src/index.ts";
import { installPackIntoAgents } from "../packages/cli/src/commands/install/agents.ts";

describe("MCP Server Runtime Translation & CLI --runtime Option", () => {
  describe("transformMcpServerRuntime unit tests", () => {
    it("translates bunx array command to npx with -y flag", () => {
      const server: McpServerConfig = {
        command: ["bunx", "-y", "@upstash/context7-mcp", "--api-key", "secret"]
      };
      const transformed = transformMcpServerRuntime(server, "npx");
      expect(transformed.command).toEqual([
        "npx",
        "-y",
        "@upstash/context7-mcp",
        "--api-key",
        "secret"
      ]);
    });

    it("ensures -y flag is inserted for npx when bunx command lacked -y", () => {
      const server: McpServerConfig = {
        command: ["bunx", "@playwright/mcp@latest"]
      };
      const transformed = transformMcpServerRuntime(server, "npx");
      expect(transformed.command).toEqual(["npx", "-y", "@playwright/mcp@latest"]);
    });

    it("translates string bunx command to npx", () => {
      const server: McpServerConfig = {
        command: "bunx @playwright/mcp@latest"
      };
      const transformed = transformMcpServerRuntime(server, "npm");
      expect(transformed.command).toBe("npx -y @playwright/mcp@latest");
    });

    it("translates command + args structure from bunx to npx with -y", () => {
      const server: McpServerConfig = {
        command: "bunx",
        args: ["@modelcontextprotocol/server-sequential-thinking"]
      };
      const transformed = transformMcpServerRuntime(server, "npx");
      expect(transformed.command).toBe("npx");
      expect(transformed.args).toEqual([
        "-y",
        "@modelcontextprotocol/server-sequential-thinking"
      ]);
    });

    it("preserves existing -y when converting command + args from bunx to npx", () => {
      const server: McpServerConfig = {
        command: "bunx",
        args: ["-y", "@upstash/context7-mcp"]
      };
      const transformed = transformMcpServerRuntime(server, "npx");
      expect(transformed.command).toBe("npx");
      expect(transformed.args).toEqual(["-y", "@upstash/context7-mcp"]);
    });

    it("translates npx command to bunx when target runtime is bun or bunx", () => {
      const server: McpServerConfig = {
        command: ["npx", "-y", "@pv-bhat/vibe-check-mcp", "start", "--stdio"]
      };
      const transformed = transformMcpServerRuntime(server, "bunx");
      expect(transformed.command).toEqual([
        "bunx",
        "-y",
        "@pv-bhat/vibe-check-mcp",
        "start",
        "--stdio"
      ]);
    });

    it("translates string npx command to bunx", () => {
      const server: McpServerConfig = {
        command: "npx -y @modelcontextprotocol/server-memory"
      };
      const transformed = transformMcpServerRuntime(server, "bun");
      expect(transformed.command).toBe("bunx -y @modelcontextprotocol/server-memory");
    });

    it("translates bunx command to pnpm dlx when target runtime is pnpm", () => {
      const server: McpServerConfig = {
        command: ["bunx", "-y", "@upstash/context7-mcp"]
      };
      const transformed = transformMcpServerRuntime(server, "pnpm");
      expect(transformed.command).toEqual(["pnpm", "dlx", "@upstash/context7-mcp"]);
    });

    it("leaves non-runner commands untouched (e.g. node, python, docker, uvx)", () => {
      const nodeServer: McpServerConfig = {
        command: "node",
        args: ["dist/index.js", "--port", "3000"]
      };
      expect(transformMcpServerRuntime(nodeServer, "npx")).toEqual(nodeServer);

      const uvxServer: McpServerConfig = {
        command: ["uvx", "mcp-server-git", "--repository", "."]
      };
      expect(transformMcpServerRuntime(uvxServer, "npx")).toEqual(uvxServer);

      const remoteServer: McpServerConfig = {
        url: "https://mcp.grep.app"
      };
      expect(transformMcpServerRuntime(remoteServer, "npx")).toEqual(remoteServer);
    });
  });

  describe("detectAvailableRuntime", () => {
    it("returns either bunx or npx as a valid string", () => {
      const runtime = detectAvailableRuntime();
      expect(["bunx", "npx"]).toContain(runtime);
    });
  });

  describe("installPackIntoAgents with runtime option", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = path.join(
        os.tmpdir(),
        "smcp-runtime-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
      );
      fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("installs pack and converts bunx to npx for opencode when runtime=npx", () => {
      const opencodeConfig = path.join(testDir, "opencode.jsonc");
      fs.writeFileSync(opencodeConfig, JSON.stringify({}), "utf8");

      const manifest: Manifest = {
        name: "test-runtime-pack",
        version: "1.0.0",
        mcpServers: {
          context7: {
            command: ["bunx", "-y", "@upstash/context7-mcp"]
          },
          playwright: {
            command: "bunx @playwright/mcp@latest"
          }
        },
        skills: []
      };

      const profiles: Record<string, AgentProfile> = {
        opencode: {
          ...DEFAULT_AGENTS.opencode,
          mcpConfig: {
            paths: [opencodeConfig],
            key: "mcp",
            format: "opencode"
          }
        }
      };

      installPackIntoAgents(
        manifest,
        ["opencode"],
        manifest.mcpServers!,
        undefined,
        undefined,
        profiles,
        undefined,
        "npx"
      );

      const parsed = JSON.parse(fs.readFileSync(opencodeConfig, "utf8"));
      expect(parsed.mcp.servers.context7.command).toEqual([
        "npx",
        "-y",
        "@upstash/context7-mcp"
      ]);
      expect(parsed.mcp.servers.playwright.command).toEqual([
        "npx",
        "-y",
        "@playwright/mcp@latest"
      ]);
    });

    it("CLI install supports -r npx and translates bunx server commands", () => {
      const { execSync } = require("node:child_process");
      const binSmcp = path.resolve(__dirname, "../packages/cli/bin/smcp.js");
      const packDir = path.join(testDir, "test-pack");
      fs.mkdirSync(packDir, { recursive: true });

      fs.writeFileSync(
        path.join(packDir, "smcp.json"),
        JSON.stringify({
          name: "cli-runtime-pack",
          version: "1.0.0",
          mcpServers: {
            sequential: {
              command: ["bunx", "-y", "@modelcontextprotocol/server-sequential-thinking"]
            }
          },
          skills: []
        }, null, 2),
        "utf8"
      );

      const targetEnv = path.join(testDir, "target-env");
      fs.mkdirSync(targetEnv, { recursive: true });
      fs.writeFileSync(
        path.join(targetEnv, "opencode.jsonc"),
        JSON.stringify({
          mcp: { servers: {} }
        }),
        "utf8"
      );

      const output = execSync(
        `node "${binSmcp}" install "${packDir}" -a opencode -f -y --json -r npx`,
        {
          cwd: targetEnv,
          encoding: "utf8",
          env: {
            ...process.env,
            SMCP_DIR: path.join(testDir, "isolated-smcp")
          }
        }
      );

      const parsedJson = JSON.parse(output);
      expect(parsedJson.success).toBe(true);

      const targetConfig = JSON.parse(fs.readFileSync(path.join(targetEnv, "opencode.jsonc"), "utf8"));
      expect(targetConfig.mcp.servers.sequential.command).toEqual([
        "npx",
        "-y",
        "@modelcontextprotocol/server-sequential-thinking"
      ]);
    });
  });
});
