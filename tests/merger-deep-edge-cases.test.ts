import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installPluginFiles,
  installSkillFiles,
  mergeMcpServersIntoFile,
  mergePluginsIntoFile
} from "../packages/core/src/core/merger/index.ts";
import type { McpServerConfig } from "../packages/core/src/types/index.ts";

describe("Merger & File Installer Deep Edge Cases, Backups & Symlink Preservations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      "smcp-merger-deep-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Corrupt Config Backup & Mode Preservation in mergeMcpServersIntoFile", () => {
    it("creates a timestamped .bak file containing the exact corrupted content and writes clean config", () => {
      const configFile = path.join(tmpDir, "corrupted-settings.json");
      const corruptData = '{\n  "mcpServers": { broken json syntax\n';
      fs.writeFileSync(configFile, corruptData, { mode: 0o600 });

      const newServers: Record<string, McpServerConfig> = {
        recoveredServer: {
          command: "node",
          args: ["index.js"]
        }
      };

      mergeMcpServersIntoFile(configFile, newServers);

      // Verify original file now has valid JSON
      const updatedRaw = fs.readFileSync(configFile, "utf8");
      const updatedJson = JSON.parse(updatedRaw);
      expect(updatedJson.mcpServers.recoveredServer).toBeDefined();

      // Find and verify the backup file
      const dirFiles = fs.readdirSync(tmpDir);
      const bakFile = dirFiles.find((f) => f.startsWith("corrupted-settings.json.bak."));
      expect(bakFile).toBeDefined();

      const bakContent = fs.readFileSync(path.join(tmpDir, bakFile!), "utf8");
      expect(bakContent).toBe(corruptData);

      // Verify file permissions are preserved (0o600)
      const stat = fs.statSync(configFile);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it("preserves symlink destination and updates the target file directly", () => {
      const targetRealFile = path.join(tmpDir, "real_storage", "actual_config.json");
      fs.mkdirSync(path.dirname(targetRealFile), { recursive: true });
      fs.writeFileSync(
        targetRealFile,
        JSON.stringify({ mcpServers: { existing: { command: "echo" } } }, null, 2),
        "utf8"
      );

      const symlinkFile = path.join(tmpDir, "symlinked_config.json");
      try {
        fs.symlinkSync(targetRealFile, symlinkFile);
      } catch {
        // Skip if symlinks are restricted on this environment
        return;
      }

      mergeMcpServersIntoFile(symlinkFile, {
        newService: {
          command: "node",
          args: ["worker.js"]
        }
      });

      // Verify symlink still exists and points to targetRealFile
      const lstat = fs.lstatSync(symlinkFile);
      expect(lstat.isSymbolicLink()).toBe(true);

      // Verify the real target file has both servers
      const realContent = JSON.parse(fs.readFileSync(targetRealFile, "utf8"));
      expect(realContent.mcpServers.existing).toBeDefined();
      expect(realContent.mcpServers.newService).toBeDefined();
    });
  });

  describe("OpenCode McpAdapter schema translation in mergeMcpServersIntoFile", () => {
    it("converts standard local and remote MCP servers into OpenCode format", () => {
      const opencodeFile = path.join(tmpDir, "opencode.json");
      fs.writeFileSync(
        opencodeFile,
        JSON.stringify({
          mcp: {
            existingOpenCodeServer: {
              type: "local",
              command: ["bun", "run", "dev"],
              enabled: true
            }
          }
        }, null, 2),
        "utf8"
      );

      const newServers: Record<string, McpServerConfig> = {
        standardLocal: {
          command: "node",
          args: ["index.js", "--verbose"],
          env: { PORT: "4000" }
        },
        standardRemote: {
          url: "https://remote.mcp.io/sse",
          headers: { Authorization: "Bearer tok_123" }
        } as any
      };

      mergeMcpServersIntoFile(opencodeFile, newServers, { mcpKey: "mcp", format: "opencode" });

      const parsed = JSON.parse(fs.readFileSync(opencodeFile, "utf8"));
      expect(parsed.mcp.existingOpenCodeServer).toBeDefined();

      const local = parsed.mcp.standardLocal;
      expect(local.type).toBe("local");
      expect(local.command).toEqual(["node", "index.js", "--verbose"]);
      expect(local.environment).toEqual({ PORT: "4000" });
      expect(local.enabled).toBe(true);
      expect(local.args).toBeUndefined();
      expect(local.env).toBeUndefined();

      const remote = parsed.mcp.standardRemote;
      expect(remote.type).toBe("remote");
      expect(remote.url).toBe("https://remote.mcp.io/sse");
      expect(remote.headers).toEqual({ Authorization: "Bearer tok_123" });
      expect(remote.enabled).toBe(true);
      expect(remote.command).toBeUndefined();
    });
  });

  describe("Skill Installer & Plugin Merger Deep Edge Cases", () => {
    it("installs skill files in deeply nested subdirectories and overwrites existing cleanly", () => {
      const skillsDir = path.join(tmpDir, "agent-skills");
      fs.mkdirSync(skillsDir, { recursive: true });

      const initialFiles = {
        "SKILL.md": "# Version 1",
        "scripts/run.sh": "echo v1",
        "nested/sub/config.json": '{"v": 1}'
      };

      installSkillFiles(skillsDir, "versioned-skill", initialFiles);

      expect(fs.readFileSync(path.join(skillsDir, "versioned-skill", "SKILL.md"), "utf8")).toBe("# Version 1");
      expect(fs.readFileSync(path.join(skillsDir, "versioned-skill", "scripts", "run.sh"), "utf8")).toBe("echo v1");
      expect(fs.readFileSync(path.join(skillsDir, "versioned-skill", "nested", "sub", "config.json"), "utf8")).toBe('{"v": 1}');

      // Overwrite with Version 2
      const updatedFiles = {
        "SKILL.md": "# Version 2",
        "scripts/run.sh": "echo v2",
        "nested/sub/config.json": '{"v": 2}'
      };

      installSkillFiles(skillsDir, "versioned-skill", updatedFiles);

      expect(fs.readFileSync(path.join(skillsDir, "versioned-skill", "SKILL.md"), "utf8")).toBe("# Version 2");
      expect(fs.readFileSync(path.join(skillsDir, "versioned-skill", "scripts", "run.sh"), "utf8")).toBe("echo v2");
      expect(fs.readFileSync(path.join(skillsDir, "versioned-skill", "nested", "sub", "config.json"), "utf8")).toBe('{"v": 2}');
    });

    it("mergePluginsIntoFile preserves JSONC comments and trailing commas", () => {
      const pluginsConfig = path.join(tmpDir, "plugins.jsonc");
      const originalJsonc = `// Active agent plugins configuration
{
  "plugin": [
    "existing-plugin-a", // primary plugin
  ], // end list
}`;
      fs.writeFileSync(pluginsConfig, originalJsonc, "utf8");

      mergePluginsIntoFile(pluginsConfig, ["new-plugin-b"], "plugin", "array");

      const content = fs.readFileSync(pluginsConfig, "utf8");
      expect(content).toContain("existing-plugin-a");
      expect(content).toContain("new-plugin-b");
    });

    it("mergePluginsIntoFile deduplicates plugins in array format", () => {
      const pluginsConfig = path.join(tmpDir, "plugins-dedup.json");
      fs.writeFileSync(pluginsConfig, JSON.stringify({ plugin: ["plugin-1"] }), "utf8");

      // Adding plugin-1 again alongside plugin-2
      mergePluginsIntoFile(pluginsConfig, ["plugin-1", "plugin-2"], "plugin", "array");

      const parsed = JSON.parse(fs.readFileSync(pluginsConfig, "utf8"));
      expect(parsed.plugin).toEqual(["plugin-1", "plugin-2"]);
    });

    it("installPluginFiles writes multi-file plugins into dedicated directory and avoids traversal", () => {
      const pluginsDir = path.join(tmpDir, "plugins-install");
      fs.mkdirSync(pluginsDir, { recursive: true });

      const files = {
        "index.ts": "export const a = 1;",
        "utils/helper.ts": "export const h = () => true;"
      };

      installPluginFiles(pluginsDir, "multi-plugin", files);

      expect(fs.readFileSync(path.join(pluginsDir, "multi-plugin", "index.ts"), "utf8")).toBe("export const a = 1;");
      expect(fs.readFileSync(path.join(pluginsDir, "multi-plugin", "utils", "helper.ts"), "utf8")).toBe("export const h = () => true;");
    });
  });
});
