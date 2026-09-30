import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_AGENTS,
  formatServerForAgent,
  getMcpAdapter,
  mergeMcpServersIntoFile,
  mergePluginsIntoFile,
  OpenCodeMcpAdapter,
  readInstalledMcpServers,
  readInstalledPlugins,
  type AgentProfile,
  type Manifest,
  type McpServerConfig
} from "../packages/core/src/index.ts";
import { installPackIntoAgents } from "../packages/cli/src/commands/install/agents.ts";

describe("OpenCode V2 Config & Plugins Migration and Hardening", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-opencode-v2-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("OpenCode Profile Defaults", () => {
    it("uses V2 keys: mcp (not mcpServers) and plugins (not plugin)", () => {
      const opencode = DEFAULT_AGENTS.opencode;
      expect(opencode.mcpConfig?.key).toBe("mcp");
      expect(opencode.mcpConfig?.format).toBe("opencode");
      expect(opencode.plugins?.key).toBe("plugins");
      expect(opencode.plugins?.dirPaths).toEqual([
        "./.opencode/plugins",
        "~/.config/opencode/plugins"
      ]);
    });
  });

  describe("OpenCodeMcpAdapter", () => {
    const adapter = new OpenCodeMcpAdapter();

    it("matches agentId 'opencode' even if targetKey was mcpServers", () => {
      expect(adapter.matches({ agentId: "opencode", targetKey: "mcpServers" })).toBe(true);
      expect(adapter.matches({ agentId: "opencode" })).toBe(true);
      expect(adapter.matches({ format: "opencode" })).toBe(true);
      expect(adapter.matches({ targetKey: "mcp" })).toBe(true);
      expect(adapter.matches({ filePath: "/path/to/opencode.jsonc" })).toBe(true);
    });

    it("serializes local server to V2 shape with command array and no enabled field", () => {
      const config: McpServerConfig = {
        command: "bunx",
        args: ["-y", "@upstash/context7-mcp", "--api-key", "secret"],
        env: { FOO: "bar" }
      };

      const serialized = adapter.serialize(config, { agentId: "opencode" });
      expect(serialized).toEqual({
        type: "local",
        command: ["bunx", "-y", "@upstash/context7-mcp", "--api-key", "secret"],
        environment: { FOO: "bar" }
      });
      expect(serialized.enabled).toBeUndefined();
      expect(serialized.args).toBeUndefined();
      expect(serialized.env).toBeUndefined();
    });

    it("serializes single command string with arguments into array tokens", () => {
      const config: McpServerConfig = {
        command: "bunx @playwright/mcp@latest"
      };

      const serialized = adapter.serialize(config, { agentId: "opencode" });
      expect(serialized.command).toEqual(["bunx", "@playwright/mcp@latest"]);
    });

    it("serializes remote server to V2 shape (e.g. grep) with no enabled field", () => {
      const config: McpServerConfig = {
        url: "https://mcp.grep.app"
      };

      const serialized = adapter.serialize(config, { agentId: "opencode" });
      expect(serialized).toEqual({
        type: "remote",
        url: "https://mcp.grep.app"
      });
      expect(serialized.enabled).toBeUndefined();
      expect(serialized.command).toBeUndefined();
    });

    it("sets disabled: true if disabled or enabled: false", () => {
      const config: McpServerConfig = {
        command: "node",
        args: ["srv.js"],
        disabled: true
      };

      const serialized = adapter.serialize(config, { agentId: "opencode" });
      expect(serialized.disabled).toBe(true);
      expect(serialized.enabled).toBeUndefined();
    });
  });

  describe("mergeMcpServersIntoFile for OpenCode V2", () => {
    it("merges into mcp.servers and removes legacy mcpServers key", () => {
      const configPath = path.join(testDir, "opencode.jsonc");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcpServers: {
            oldServer: { command: "node", args: ["old.js"] }
          }
        }, null, 2),
        "utf8"
      );

      mergeMcpServersIntoFile(
        configPath,
        {
          context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] },
          grep: { url: "https://mcp.grep.app" }
        },
        { agentId: "opencode", mcpKey: "mcp" }
      );

      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(parsed.mcpServers).toBeUndefined();
      expect(parsed.mcp).toBeDefined();
      expect(parsed.mcp.servers).toBeDefined();
      expect(parsed.mcp.servers.oldServer).toEqual({
        type: "local",
        command: ["node", "old.js"]
      });
      expect(parsed.mcp.servers.context7).toEqual({
        type: "local",
        command: ["bunx", "-y", "@upstash/context7-mcp"]
      });
      expect(parsed.mcp.servers.grep).toEqual({
        type: "remote",
        url: "https://mcp.grep.app"
      });
    });

    it("migrates legacy direct mcp[serverName] into mcp.servers while preserving mcp.timeout", () => {
      const configPath = path.join(testDir, "opencode.jsonc");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          mcp: {
            timeout: { startup: 45000 },
            legacyLocal: { type: "local", command: ["bunx", "tool"], enabled: true }
          }
        }, null, 2),
        "utf8"
      );

      mergeMcpServersIntoFile(
        configPath,
        {
          newServer: { command: "bunx", args: ["new-tool"] }
        },
        { agentId: "opencode", mcpKey: "mcp" }
      );

      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(parsed.mcp.timeout).toEqual({ startup: 45000 });
      expect(parsed.mcp.legacyLocal).toBeUndefined();
      expect(parsed.mcp.servers.legacyLocal).toEqual({
        type: "local",
        command: ["bunx", "tool"]
      });
      expect(parsed.mcp.servers.newServer).toEqual({
        type: "local",
        command: ["bunx", "new-tool"]
      });
    });
  });

  describe("mergePluginsIntoFile for OpenCode V2", () => {
    it("writes to plugins key, migrates plugin key, and filters out .ts/.js file paths", () => {
      const configPath = path.join(testDir, "opencode.jsonc");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          plugin: [
            "opencode-gemini-auth@latest",
            "./plugin/antigravity.ts"
          ]
        }, null, 2),
        "utf8"
      );

      mergePluginsIntoFile(
        configPath,
        [
          "opencode-new-pkg@1.0.0",
          "./.opencode/plugins/antigravity.ts"
        ],
        "plugins",
        "array"
      );

      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(parsed.plugin).toBeUndefined();
      expect(parsed.plugins).toBeDefined();
      expect(parsed.plugins).toEqual([
        "opencode-gemini-auth@latest",
        "opencode-new-pkg@1.0.0"
      ]);
      // Ensure no .ts file path survives in plugins array (v2.0.20 rejection prevention)
      expect(parsed.plugins.some((p: string) => p.endsWith(".ts"))).toBe(false);
    });
  });

  describe("installPackIntoAgents end-to-end for OpenCode", () => {
    it("installs MCP servers to mcp.servers and places local plugin in .opencode/plugins without polluting plugins array", () => {
      const opencodeConfig = path.join(testDir, "opencode.jsonc");
      const pluginsDir = path.join(testDir, ".opencode", "plugins");

      fs.writeFileSync(
        opencodeConfig,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json"
        }, null, 2),
        "utf8"
      );

      const manifest: Manifest = {
        name: "test-v2-pack",
        version: "1.0.0",
        mcpServers: {
          context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] },
          grep: { url: "https://mcp.grep.app" }
        },
        skills: [],
        plugins: [
          "opencode-gemini-auth@latest",
          {
            name: "antigravity.ts",
            targetAgent: "opencode",
            files: {
              "antigravity.ts": "// antigravity plugin\nimport { x } from 'opencode-antigravity-auth';"
            }
          }
        ]
      };

      const profiles: Record<string, AgentProfile> = {
        opencode: {
          ...DEFAULT_AGENTS.opencode,
          mcpConfig: {
            paths: [opencodeConfig],
            key: "mcp",
            format: "opencode"
          },
          plugins: {
            paths: [opencodeConfig],
            key: "plugins",
            format: "array",
            dirPaths: [pluginsDir]
          }
        }
      };

      const result = installPackIntoAgents(
        manifest,
        ["opencode"],
        manifest.mcpServers!,
        undefined,
        undefined,
        profiles,
        pluginsDir
      );

      expect(result.installedMcp).toContain("opencode");
      expect(result.installedPlugins).toContain("opencode");

      // Verify opencode.jsonc
      const parsed = JSON.parse(fs.readFileSync(opencodeConfig, "utf8"));
      expect(parsed.mcp.servers.context7).toEqual({
        type: "local",
        command: ["bunx", "-y", "@upstash/context7-mcp"]
      });
      expect(parsed.mcp.servers.grep).toEqual({
        type: "remote",
        url: "https://mcp.grep.app"
      });
      // plugins array has npm package, but NOT antigravity.ts
      expect(parsed.plugins).toEqual(["opencode-gemini-auth@latest"]);

      // Verify .opencode/plugins/antigravity.ts was created
      const installedFile = path.join(pluginsDir, "antigravity.ts");
      expect(fs.existsSync(installedFile)).toBe(true);
      expect(fs.readFileSync(installedFile, "utf8")).toContain("antigravity plugin");
    });

    it("ensures imported modules in plugins (like opencode-antigravity-auth) are resolvable upward from plugin location", () => {
      const opencodeConfig = path.join(testDir, "opencode.jsonc");
      const pluginsDir = path.join(testDir, ".opencode", "plugins");

      // Simulate global opencode node_modules having opencode-antigravity-auth
      const globalOpencodeDir = path.join(testDir, "global-opencode");
      const globalNodeModules = path.join(globalOpencodeDir, "node_modules", "opencode-antigravity-auth");
      fs.mkdirSync(globalNodeModules, { recursive: true });
      fs.writeFileSync(path.join(globalNodeModules, "package.json"), JSON.stringify({ name: "opencode-antigravity-auth", version: "1.0.0" }), "utf8");

      fs.writeFileSync(opencodeConfig, JSON.stringify({}), "utf8");

      const manifest: Manifest = {
        name: "test-antigravity-pack",
        version: "1.0.0",
        mcpServers: {},
        skills: [],
        plugins: [
          {
            name: "antigravity.ts",
            targetAgent: "opencode",
            files: {
              "antigravity.ts": "import { authorizeAntigravity } from 'opencode-antigravity-auth';\nexport default { id: 'antigravity' };"
            }
          }
        ]
      };

      const profiles: Record<string, AgentProfile> = {
        opencode: {
          ...DEFAULT_AGENTS.opencode,
          plugins: {
            paths: [opencodeConfig],
            key: "plugins",
            format: "array",
            dirPaths: [pluginsDir]
          }
        }
      };

      installPackIntoAgents(
        manifest,
        ["opencode"],
        {},
        undefined,
        undefined,
        profiles,
        pluginsDir
      );

      // Verify that from pluginsDir upward, node_modules/opencode-antigravity-auth exists
      const upwardNodeModules = path.join(testDir, ".opencode", "node_modules", "opencode-antigravity-auth");
      const projectNodeModules = path.join(testDir, "node_modules", "opencode-antigravity-auth");
      const pluginNodeModules = path.join(pluginsDir, "node_modules", "opencode-antigravity-auth");

      const isResolvable =
        fs.existsSync(upwardNodeModules) ||
        fs.existsSync(projectNodeModules) ||
        fs.existsSync(pluginNodeModules);

      expect(isResolvable).toBe(true);
    });
  });
});
