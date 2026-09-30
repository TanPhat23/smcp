import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_AGENTS,
  detectAgents,
  expandHome,
  isStrictlyInside,
  mergeMcpServersIntoFile,
  mergePluginsIntoFile,
  OpenCodeMcpAdapter,
  resolveActiveAgentPath,
  type AgentProfile,
  type Manifest,
  type McpServerConfig
} from "../packages/core/src/index.ts";
import { installPackIntoAgents } from "../packages/cli/src/commands/install/agents.ts";

describe("Windows Environment & Path Compatibility Hardening", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-win-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("expandHome and path normalization for Windows", () => {
    it("handles %APPDATA% expansion when present in Windows config paths", () => {
      const originalAppData = process.env.APPDATA;
      try {
        process.env.APPDATA = "C:\\Users\\ROG\\AppData\\Roaming";
        const expanded = expandHome("%APPDATA%/Claude/claude_desktop_config.json");
        expect(expanded).toContain("AppData");
        expect(expanded).toContain("claude_desktop_config.json");
      } finally {
        if (originalAppData !== undefined) {
          process.env.APPDATA = originalAppData;
        } else {
          delete process.env.APPDATA;
        }
      }
    });

    it("handles Windows backward slash tilde paths (~\\)", () => {
      const expanded = expandHome("~\\.config\\opencode\\opencode.jsonc");
      expect(expanded).toContain(".config");
      expect(expanded).toContain("opencode.jsonc");
    });
  });

  describe("isStrictlyInside Windows Drive Casing & Separator Resilience", () => {
    it("handles differing drive letter casing on Windows without false positive traversal errors", () => {
      // Simulate Windows drive letter difference: C: vs c:
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      try {
        const baseUpper = "C:\\Users\\ROG\\.opencode\\plugins";
        const targetLower = "c:\\users\\rog\\.opencode\\plugins\\antigravity.ts";

        // Must evaluate true on Windows
        const result = isStrictlyInside(baseUpper, targetLower);
        expect(result).toBe(true);

        // Outside path must still evaluate false
        const targetEscape = "c:\\users\\rog\\other-dir\\malicious.ts";
        expect(isStrictlyInside(baseUpper, targetEscape)).toBe(false);
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      }
    });
  });

  describe("Project-Local Windows Precedence Scenario (C:\\Users\\ROG\\opencode.jsonc)", () => {
    it("detects project-local opencode.jsonc when global directory contains only service.json", () => {
      const projectDir = path.join(testDir, "user-rog-project");
      const globalConfigDir = path.join(testDir, "global-config");
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(globalConfigDir, { recursive: true });

      // Global contains only service.json (no config file)
      fs.writeFileSync(path.join(globalConfigDir, "service.json"), JSON.stringify({ pid: 1234 }), "utf8");

      // Project-local contains opencode.jsonc
      const localConfigPath = path.join(projectDir, "opencode.jsonc");
      fs.writeFileSync(
        localConfigPath,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            servers: {
              grep: { type: "remote", url: "https://mcp.grep.app" }
            }
          }
        }, null, 2),
        "utf8"
      );

      const customProfiles: Record<string, AgentProfile> = {
        opencode: {
          ...DEFAULT_AGENTS.opencode,
          mcpConfig: {
            paths: [localConfigPath, path.join(globalConfigDir, "opencode.jsonc")],
            key: "mcp",
            format: "opencode"
          },
          plugins: {
            paths: [localConfigPath, path.join(globalConfigDir, "opencode.jsonc")],
            key: "plugins",
            format: "array",
            dirPaths: [path.join(projectDir, ".opencode", "plugins")]
          }
        }
      };

      const detected = detectAgents(customProfiles);
      const oc = detected.find((a) => a.id === "opencode");
      expect(oc).toBeDefined();
      expect(oc?.mcpConfigPath).toBe(localConfigPath);
      expect(oc?.pluginsConfigPath).toBe(localConfigPath);
    });

    it("installs into project-local Windows configuration with V2 shape (mcp.servers) and auto-discovery plugins", () => {
      const projectDir = path.join(testDir, "user-rog-project");
      fs.mkdirSync(projectDir, { recursive: true });

      const localConfigPath = path.join(projectDir, "opencode.jsonc");
      fs.writeFileSync(
        localConfigPath,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json"
        }, null, 2),
        "utf8"
      );

      const pluginsDir = path.join(projectDir, ".opencode", "plugins");

      const manifest: Manifest = {
        name: "windows-pack",
        version: "1.0.0",
        mcpServers: {
          playwright: { command: "bunx", args: ["@playwright/mcp@latest"] }
        },
        skills: [],
        plugins: [
          "opencode-gemini-auth@latest",
          {
            name: "antigravity.ts",
            targetAgent: "opencode",
            files: {
              "antigravity.ts": "export default { id: 'antigravity-win' };"
            }
          }
        ]
      };

      const customProfiles: Record<string, AgentProfile> = {
        opencode: {
          ...DEFAULT_AGENTS.opencode,
          mcpConfig: {
            paths: [localConfigPath],
            key: "mcp",
            format: "opencode"
          },
          plugins: {
            paths: [localConfigPath],
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
        customProfiles,
        pluginsDir
      );

      expect(result.installedMcp).toContain("opencode");
      expect(result.installedPlugins).toContain("opencode");

      // Verify V2 shape in project-local opencode.jsonc
      const parsed = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
      expect(parsed.mcp).toBeDefined();
      expect(parsed.mcp.servers).toBeDefined();
      expect(parsed.mcp.servers.playwright).toEqual({
        type: "local",
        command: ["bunx", "@playwright/mcp@latest"]
      });

      // Plugins array must have package, but NOT antigravity.ts (preventing v2.0.20 rejection)
      expect(parsed.plugins).toEqual(["opencode-gemini-auth@latest"]);
      expect(parsed.plugin).toBeUndefined();

      // Plugin file must be placed in .opencode/plugins/antigravity.ts
      expect(fs.existsSync(path.join(pluginsDir, "antigravity.ts"))).toBe(true);
    });

    it("normalizes Windows-style backslashes in plugin and skill filenames", () => {
      const projectDir = path.join(testDir, "win-backslash-project");
      const pluginsDir = path.join(projectDir, ".opencode", "plugins");
      fs.mkdirSync(projectDir, { recursive: true });

      const localConfig = path.join(projectDir, "opencode.json");
      fs.writeFileSync(localConfig, JSON.stringify({}), "utf8");

      const manifest: Manifest = {
        name: "backslash-pack",
        version: "1.0.0",
        mcpServers: {},
        skills: [],
        plugins: [
          {
            name: "nested-tool",
            targetAgent: "opencode",
            files: {
              "sub\\helper.ts": "export const help = true;",
              "index.ts": "import './sub/helper';"
            }
          }
        ]
      };

      const profiles: Record<string, AgentProfile> = {
        opencode: {
          ...DEFAULT_AGENTS.opencode,
          plugins: {
            paths: [localConfig],
            key: "plugins",
            format: "array",
            dirPaths: [pluginsDir]
          }
        }
      };

      installPackIntoAgents(manifest, ["opencode"], {}, undefined, undefined, profiles, pluginsDir);

      expect(fs.existsSync(path.join(pluginsDir, "nested-tool", "sub", "helper.ts"))).toBe(true);
      expect(fs.existsSync(path.join(pluginsDir, "nested-tool", "index.ts"))).toBe(true);
    });
  });
});
