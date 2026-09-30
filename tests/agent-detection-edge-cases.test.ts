import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectAgents,
  filterAgents,
  readInstalledMcpServers,
  readInstalledPlugins,
  registerAgentProfile,
  resetAgentProfiles,
  scanSkills,
  type DetectedAgent
} from "../packages/core/src/core/agents/index.ts";
import type { AgentProfile } from "../packages/core/src/types/index.ts";

describe("Agent Detection, Scanning & Filtering Deep Edge Cases", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      "smcp-agents-edge-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    resetAgentProfiles();
  });

  afterEach(() => {
    resetAgentProfiles();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("detectAgents edge cases", () => {
    it("returns empty array when no configured agent paths exist", () => {
      const mockProfiles: Record<string, AgentProfile> = {
        phantomAgent: {
          name: "Phantom",
          mcpConfig: {
            paths: [path.join(tmpDir, "nonexistent", "config.json")],
            key: "mcpServers"
          },
          skills: {
            paths: [path.join(tmpDir, "nonexistent", "skills")]
          }
        }
      };

      const detected = detectAgents(mockProfiles);
      expect(detected).toEqual([]);
    });

    it("ignores directory when expecting MCP config file, and ignores file when expecting skills directory", () => {
      // Create a directory where a file was expected
      const dirWhereFileExpected = path.join(tmpDir, "dir-as-mcp-config");
      fs.mkdirSync(dirWhereFileExpected, { recursive: true });

      // Create a file where a directory was expected
      const fileWhereDirExpected = path.join(tmpDir, "file-as-skills-dir");
      fs.writeFileSync(fileWhereDirExpected, "not a directory", "utf8");

      const mockProfiles: Record<string, AgentProfile> = {
        mismatchedTypesAgent: {
          name: "Mismatched",
          mcpConfig: {
            paths: [dirWhereFileExpected],
            key: "mcpServers"
          },
          skills: {
            paths: [fileWhereDirExpected]
          }
        }
      };

      const detected = detectAgents(mockProfiles);
      // Because dir is not a file and file is not a dir, neither should match
      expect(detected).toEqual([]);
    });

    it("detects agent when only plugin config or plugin directory exists", () => {
      const pluginDir = path.join(tmpDir, "custom-agent-plugins");
      fs.mkdirSync(pluginDir, { recursive: true });

      const mockProfiles: Record<string, AgentProfile> = {
        pluginOnlyAgent: {
          name: "Plugin Only",
          plugins: {
            paths: [],
            key: "plugin",
            format: "array",
            dirPaths: [pluginDir]
          }
        }
      };

      const detected = detectAgents(mockProfiles);
      expect(detected).toHaveLength(1);
      expect(detected[0].id).toBe("pluginOnlyAgent");
      expect(detected[0].pluginsDirPath).toBe(pluginDir);
    });
  });

  describe("filterAgents edge cases", () => {
    const sampleAgents: DetectedAgent[] = [
      { id: "opencode", name: "OpenCode", mcpConfigPath: null, skillsDirPath: null },
      { id: "claude-code", name: "Claude Code", mcpConfigPath: null, skillsDirPath: null },
      { id: "claude-desktop", name: "Claude Desktop", mcpConfigPath: null, skillsDirPath: null },
      { id: "cursor", name: "Cursor", mcpConfigPath: null, skillsDirPath: null },
      { id: "windsurf", name: "Windsurf", mcpConfigPath: null, skillsDirPath: null }
    ];

    it("returns all agents when filter list is empty, whitespace, or commas only", () => {
      expect(filterAgents(sampleAgents)).toEqual(sampleAgents);
      expect(filterAgents(sampleAgents, [])).toEqual(sampleAgents);
      expect(filterAgents(sampleAgents, ["   ", ""])).toEqual(sampleAgents);
      expect(filterAgents(sampleAgents, [",,,"])).toEqual(sampleAgents);
    });

    it("matches 'claude' alias to all claude agents (claude-code and claude-desktop)", () => {
      const filtered = filterAgents(sampleAgents, ["claude"]);
      const ids = filtered.map((a) => a.id);
      expect(ids).toContain("claude-code");
      expect(ids).toContain("claude-desktop");
      expect(ids).not.toContain("cursor");
      expect(ids).not.toContain("opencode");
    });

    it("handles comma-separated terms and case insensitivity", () => {
      const filtered = filterAgents(sampleAgents, ["CuRsOr, WINDSURF"]);
      const ids = filtered.map((a) => a.id);
      expect(ids).toEqual(["cursor", "windsurf"]);
    });

    it("returns empty array when filter terms match no agents", () => {
      const filtered = filterAgents(sampleAgents, ["nonexistent-agent-404"]);
      expect(filtered).toEqual([]);
    });
  });

  describe("scanSkills deep edge cases", () => {
    it("ignores non-markdown files, hidden directories, and finds README.md fallback", () => {
      const skillsDir = path.join(tmpDir, "all-skills");
      fs.mkdirSync(skillsDir, { recursive: true });

      // Hidden directory .git - should be skipped
      const hiddenDir = path.join(skillsDir, ".git");
      fs.mkdirSync(hiddenDir, { recursive: true });
      fs.writeFileSync(path.join(hiddenDir, "SKILL.md"), "hidden skill", "utf8");

      // Non-markdown file in root skills dir - should be skipped
      fs.writeFileSync(path.join(skillsDir, ".DS_Store"), "binary", "utf8");
      fs.writeFileSync(path.join(skillsDir, "notes.txt"), "text", "utf8");
      fs.writeFileSync(path.join(skillsDir, "script.sh"), "echo 1", "utf8");

      // Skill directory with README.md instead of SKILL.md
      const readmeSkillDir = path.join(skillsDir, "readme-skill");
      fs.mkdirSync(readmeSkillDir, { recursive: true });
      fs.writeFileSync(path.join(readmeSkillDir, "README.md"), "# Readme Skill", "utf8");

      // Skill directory with SKILL.md
      const standardSkillDir = path.join(skillsDir, "standard-skill");
      fs.mkdirSync(standardSkillDir, { recursive: true });
      fs.writeFileSync(path.join(standardSkillDir, "SKILL.md"), "# Standard Skill", "utf8");

      // Direct standalone markdown file
      fs.writeFileSync(path.join(skillsDir, "standalone.md"), "# Standalone Skill", "utf8");

      const scanned = scanSkills(skillsDir);
      const names = scanned.map((s) => s.name);

      expect(names).toContain("readme-skill");
      expect(names).toContain("standard-skill");
      expect(names).toContain("standalone");
      expect(names).not.toContain(".git");
      expect(names).not.toContain(".DS_Store");
      expect(names).not.toContain("notes.txt");
    });

    it("returns empty array for non-existent or unreadable skills directory", () => {
      expect(scanSkills("")).toEqual([]);
      expect(scanSkills(path.join(tmpDir, "does-not-exist"))).toEqual([]);
    });
  });

  describe("readInstalledMcpServers & readInstalledPlugins edge cases", () => {
    it("reads OpenCode nested mcp.servers dictionary", () => {
      const cfgPath = path.join(tmpDir, "opencode-nested.json");
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          mcp: {
            servers: {
              serverA: { command: "node", args: ["a.js"] },
              serverB: { command: "node", args: ["b.js"] }
            }
          }
        }, null, 2),
        "utf8"
      );

      const servers = readInstalledMcpServers(cfgPath, "mcp");
      expect(servers.serverA).toBeDefined();
      expect(servers.serverA.command).toBe("node");
      expect(servers.serverB).toBeDefined();
    });

    it("reads Claude Code ~/.claude.json projects map format", () => {
      const claudeCfg = path.join(tmpDir, "claude-projects.json");
      const cwd = process.cwd();
      fs.writeFileSync(
        claudeCfg,
        JSON.stringify({
          projects: {
            [cwd]: {
              mcpServers: {
                projectMcp: {
                  command: "bunx",
                  args: ["mcp-server"]
                }
              }
            }
          }
        }, null, 2),
        "utf8"
      );

      const servers = readInstalledMcpServers(claudeCfg);
      expect(servers.projectMcp).toBeDefined();
      expect(servers.projectMcp.command).toBe("bunx");
    });

    it("readInstalledPlugins handles map format with enabled/disabled booleans", () => {
      const pluginsCfg = path.join(tmpDir, "plugins-map.json");
      fs.writeFileSync(
        pluginsCfg,
        JSON.stringify({
          enabledPlugins: {
            "plugin-active-1": true,
            "plugin-disabled-2": false,
            "plugin-active-3": true
          }
        }, null, 2),
        "utf8"
      );

      const plugins = readInstalledPlugins(pluginsCfg, "enabledPlugins", "map");
      const names = plugins.map((p) => p.name);

      expect(names).toContain("plugin-active-1");
      expect(names).toContain("plugin-active-3");
      expect(names).not.toContain("plugin-disabled-2");
    });
  });
});
