import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_AGENTS,
  detectAgents,
  getAgentProfiles,
  readInstalledMcpServers,
  saveCustomAgent,
  scanSkills,
  type DetectedAgent
} from "../src/core/agents.ts";
import { AgentProfileSchema } from "../src/types.ts";
import { hashContent } from "../src/utils/crypto.ts";

describe("Agent Profiles Registry & Default Agents", () => {
  it("provides all default built-in profiles", () => {
    const defaultIds = ["opencode", "claude-code", "claude-desktop", "cursor", "windsurf"];
    for (const id of defaultIds) {
      expect(DEFAULT_AGENTS[id]).toBeDefined();
    }
  });

  it("validates every default agent against AgentProfileSchema", () => {
    for (const [id, profile] of Object.entries(DEFAULT_AGENTS)) {
      const parsed = AgentProfileSchema.parse(profile);
      expect(parsed.name).toBe(profile.name);
      expect(parsed.name.length).toBeGreaterThan(0);
    }
  });

  it("validates OpenCode profile paths and keys", () => {
    const opencode = DEFAULT_AGENTS.opencode;
    expect(opencode.name).toBe("OpenCode");
    expect(opencode.mcpConfig?.key).toBe("mcpServers");
    expect(opencode.mcpConfig?.paths).toContain("~/.config/opencode/opencode.json");
    expect(opencode.mcpConfig?.paths).toContain("./opencode.json");
    expect(opencode.skills?.paths).toContain("~/.config/opencode/skills");
    expect(opencode.skills?.paths).toContain("./.opencode/skills");
  });

  it("validates Claude Code profile paths and keys", () => {
    const claudeCode = DEFAULT_AGENTS["claude-code"];
    expect(claudeCode.name).toBe("Claude Code");
    expect(claudeCode.mcpConfig?.key).toBe("mcpServers");
    expect(claudeCode.mcpConfig?.paths).toContain("~/.claude.json");
    expect(claudeCode.mcpConfig?.paths).toContain("./.claude.json");
    expect(claudeCode.skills?.paths).toContain("~/.claude/skills");
    expect(claudeCode.skills?.paths).toContain("./skills");
  });

  it("validates Claude Desktop profile paths, key, and null skills", () => {
    const desktop = DEFAULT_AGENTS["claude-desktop"];
    expect(desktop.name).toBe("Claude Desktop");
    expect(desktop.mcpConfig?.key).toBe("mcpServers");
    expect(desktop.mcpConfig?.paths).toContain("~/.config/Claude/claude_desktop_config.json");
    expect(desktop.mcpConfig?.paths).toContain("~/Library/Application Support/Claude/claude_desktop_config.json");
    expect(desktop.mcpConfig?.paths).toContain("%APPDATA%/Claude/claude_desktop_config.json");
    expect(desktop.skills).toBeNull();
  });

  it("validates Cursor profile paths and keys", () => {
    const cursor = DEFAULT_AGENTS.cursor;
    expect(cursor.name).toBe("Cursor");
    expect(cursor.mcpConfig?.key).toBe("mcpServers");
    expect(cursor.mcpConfig?.paths).toContain("~/.cursor/mcp.json");
    expect(cursor.mcpConfig?.paths).toContain("./.cursor/mcp.json");
    expect(cursor.skills?.paths).toContain("~/.cursor/skills");
    expect(cursor.skills?.paths).toContain("./.cursor/rules");
  });

  it("validates Windsurf profile paths and keys", () => {
    const windsurf = DEFAULT_AGENTS.windsurf;
    expect(windsurf.name).toBe("Windsurf");
    expect(windsurf.mcpConfig?.key).toBe("mcpServers");
    expect(windsurf.mcpConfig?.paths).toContain("~/.codeium/windsurf/mcp_config.json");
    expect(windsurf.skills?.paths).toContain("~/.codeium/windsurf/skills");
  });

  it("returns a detached copy so mutating returned profiles does not mutate DEFAULT_AGENTS", () => {
    const profiles = getAgentProfiles();
    profiles.opencode.name = "Mutated OpenCode";
    expect(DEFAULT_AGENTS.opencode.name).toBe("OpenCode");
  });
});

describe("Custom Agent Management", () => {
  const testDir = path.join(os.tmpdir(), "smcp-agents-test-" + Date.now());
  const customAgentsFile = path.join(testDir, "custom-agents.json");

  beforeEach(() => {
    process.env.SMCP_CUSTOM_AGENTS_PATH = customAgentsFile;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    delete process.env.SMCP_CUSTOM_AGENTS_PATH;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("saves a custom agent to custom-agents.json and getAgentProfiles() includes it", () => {
    saveCustomAgent("my-agent", {
      name: "My Custom Agent",
      mcpConfig: {
        paths: ["/path/to/custom-mcp.json"],
        key: "mcpServers"
      },
      skills: {
        paths: ["/path/to/skills"]
      }
    });

    expect(fs.existsSync(customAgentsFile)).toBe(true);
    const content = JSON.parse(fs.readFileSync(customAgentsFile, "utf8"));
    expect(content["my-agent"]).toBeDefined();
    expect(content["my-agent"].name).toBe("My Custom Agent");

    const allProfiles = getAgentProfiles();
    expect(allProfiles["my-agent"]).toBeDefined();
    expect(allProfiles["my-agent"].name).toBe("My Custom Agent");
    expect(allProfiles.opencode).toBeDefined();
  });

  it("updates an existing custom agent without removing other custom agents", () => {
    saveCustomAgent("agent-1", {
      name: "Agent One",
      mcpConfig: null,
      skills: null
    });
    saveCustomAgent("agent-2", {
      name: "Agent Two",
      mcpConfig: null,
      skills: null
    });

    let profiles = getAgentProfiles();
    expect(profiles["agent-1"].name).toBe("Agent One");
    expect(profiles["agent-2"].name).toBe("Agent Two");

    saveCustomAgent("agent-1", {
      name: "Agent One Updated",
      mcpConfig: null,
      skills: null
    });

    profiles = getAgentProfiles();
    expect(profiles["agent-1"].name).toBe("Agent One Updated");
    expect(profiles["agent-2"].name).toBe("Agent Two");
  });

  it("handles corrupt custom-agents.json gracefully", () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(customAgentsFile, "{ invalid json corrupt content !!!", "utf8");

    // getAgentProfiles should not throw, returns default agents
    const profiles = getAgentProfiles();
    expect(profiles.opencode).toBeDefined();
    expect(profiles["my-corrupt-agent"]).toBeUndefined();

    // saveCustomAgent should overwrite or recover cleanly
    saveCustomAgent("recovered-agent", {
      name: "Recovered Agent",
      mcpConfig: null,
      skills: null
    });

    const updated = getAgentProfiles();
    expect(updated["recovered-agent"]).toBeDefined();
    expect(updated["recovered-agent"].name).toBe("Recovered Agent");
  });

  it("prevents prototype pollution keys when saving or loading", () => {
    expect(() => {
      saveCustomAgent("__proto__", {
        name: "Malicious",
        mcpConfig: null,
        skills: null
      });
    }).toThrow();
  });
});

describe("detectAgents()", () => {
  const testDir = path.join(os.tmpdir(), "smcp-detect-test-" + Date.now());

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("returns empty array when none of the configured paths exist", () => {
    const mockProfiles = {
      ghost: {
        name: "Ghost Agent",
        mcpConfig: { paths: [path.join(testDir, "nonexistent-mcp.json")], key: "mcpServers" },
        skills: { paths: [path.join(testDir, "nonexistent-skills")] }
      }
    };

    const detected = detectAgents(mockProfiles);
    expect(detected).toEqual([]);
  });

  it("detects an agent when its mcp config file exists", () => {
    const mcpPath = path.join(testDir, "custom-mcp.json");
    fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }), "utf8");

    const mockProfiles = {
      testAgent: {
        name: "Test MCP Agent",
        mcpConfig: { paths: [mcpPath], key: "mcpServers" },
        skills: { paths: [path.join(testDir, "no-skills")] }
      }
    };

    const detected = detectAgents(mockProfiles);
    expect(detected.length).toBe(1);
    expect(detected[0].id).toBe("testAgent");
    expect(detected[0].name).toBe("Test MCP Agent");
    expect(detected[0].mcpConfigPath).toBe(mcpPath);
    expect(detected[0].skillsDirPath).toBeNull();
  });

  it("detects an agent when its skills directory exists", () => {
    const skillsDir = path.join(testDir, "agent-skills");
    fs.mkdirSync(skillsDir, { recursive: true });

    const mockProfiles = {
      skillsAgent: {
        name: "Skills Only Agent",
        mcpConfig: null,
        skills: { paths: [skillsDir] }
      }
    };

    const detected = detectAgents(mockProfiles);
    expect(detected.length).toBe(1);
    expect(detected[0].id).toBe("skillsAgent");
    expect(detected[0].skillsDirPath).toBe(skillsDir);
    expect(detected[0].mcpConfigPath).toBeNull();
  });

  it("detects an agent when both mcp config and skills directory exist", () => {
    const mcpPath = path.join(testDir, "both-mcp.json");
    const skillsDir = path.join(testDir, "both-skills");
    fs.writeFileSync(mcpPath, "{}", "utf8");
    fs.mkdirSync(skillsDir, { recursive: true });

    const mockProfiles = {
      fullAgent: {
        name: "Full Agent",
        mcpConfig: { paths: [mcpPath], key: "mcpServers" },
        skills: { paths: [skillsDir] }
      }
    };

    const detected = detectAgents(mockProfiles);
    expect(detected.length).toBe(1);
    expect(detected[0].mcpConfigPath).toBe(mcpPath);
    expect(detected[0].skillsDirPath).toBe(skillsDir);
  });

  it("picks the first matching path when multiple paths are defined", () => {
    const pathFirst = path.join(testDir, "first.json");
    const pathSecond = path.join(testDir, "second.json");
    fs.writeFileSync(pathFirst, "{}", "utf8");
    fs.writeFileSync(pathSecond, "{}", "utf8");

    const mockProfiles = {
      multiPath: {
        name: "Multi Path Agent",
        mcpConfig: { paths: [pathFirst, pathSecond], key: "mcpServers" },
        skills: null
      }
    };

    const detected = detectAgents(mockProfiles);
    expect(detected[0].mcpConfigPath).toBe(pathFirst);
  });
});

describe("readInstalledMcpServers()", () => {
  const testDir = path.join(os.tmpdir(), "smcp-readmcp-test-" + Date.now());

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("parses servers from a json config file with default key 'mcpServers'", () => {
    const configPath = path.join(testDir, "config.json");
    const payload = {
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"]
        },
        memory: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-memory"]
        }
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(payload), "utf8");

    const servers = readInstalledMcpServers(configPath);
    expect(servers.github).toBeDefined();
    expect(servers.github.command).toBe("npx");
    expect(servers.memory).toBeDefined();
    expect(Object.keys(servers)).toHaveLength(2);
  });

  it("parses servers under a custom configured key", () => {
    const configPath = path.join(testDir, "custom-key.json");
    const payload = {
      customServers: {
        localServer: {
          command: "node",
          args: ["server.js"]
        }
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(payload), "utf8");

    const servers = readInstalledMcpServers(configPath, "customServers");
    expect(servers.localServer).toBeDefined();
    expect(servers.localServer.command).toBe("node");
  });

  it("returns empty object if file does not exist", () => {
    const servers = readInstalledMcpServers(path.join(testDir, "nonexistent.json"));
    expect(servers).toEqual({});
  });

  it("returns empty object if file contains invalid or corrupt JSON", () => {
    const corruptPath = path.join(testDir, "corrupt.json");
    fs.writeFileSync(corruptPath, "{ corrupt content !!!", "utf8");

    const servers = readInstalledMcpServers(corruptPath);
    expect(servers).toEqual({});
  });

  it("returns empty object if configured key is missing or not an object", () => {
    const configPath = path.join(testDir, "missing-key.json");
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: "not-an-object", other: 123 }), "utf8");

    const servers = readInstalledMcpServers(configPath);
    expect(servers).toEqual({});

    const emptyServers = readInstalledMcpServers(configPath, "nonexistentKey");
    expect(emptyServers).toEqual({});
  });

  it("returns empty object if path points to a directory instead of a file", () => {
    const subDir = path.join(testDir, "some-directory");
    fs.mkdirSync(subDir, { recursive: true });

    const servers = readInstalledMcpServers(subDir);
    expect(servers).toEqual({});
  });
});

describe("scanSkills()", () => {
  const testDir = path.join(os.tmpdir(), "smcp-scanskills-test-" + Date.now());

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("reads skills from standalone markdown files with content hashes", () => {
    const skillContent = "# Commit Helper\nAutomates git commits.";
    fs.writeFileSync(path.join(testDir, "commit-helper.md"), skillContent, "utf8");

    const skills = scanSkills(testDir);
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("commit-helper");
    expect(skills[0].path).toBe(path.join(testDir, "commit-helper.md"));
    expect(skills[0].contentHash).toBe(hashContent(skillContent));
    expect(skills[0].description).toBe("Skill commit-helper.md");
  });

  it("reads skills from subdirectories containing SKILL.md with content hashes", () => {
    const skillDir = path.join(testDir, "code-review");
    fs.mkdirSync(skillDir, { recursive: true });
    const skillContent = "# Code Review\nConducts code reviews.";
    const skillFile = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(skillFile, skillContent, "utf8");

    const skills = scanSkills(testDir);
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("code-review");
    expect(skills[0].path).toBe(skillFile);
    expect(skills[0].contentHash).toBe(hashContent(skillContent));
    expect(skills[0].description).toBe("Skill in code-review");
  });

  it("reads skills from subdirectories containing README.md when SKILL.md is absent", () => {
    const skillDir = path.join(testDir, "readme-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    const readmeContent = "# Readme Skill\nFallback documentation.";
    const readmeFile = path.join(skillDir, "README.md");
    fs.writeFileSync(readmeFile, readmeContent, "utf8");

    const skills = scanSkills(testDir);
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("readme-skill");
    expect(skills[0].path).toBe(readmeFile);
    expect(skills[0].contentHash).toBe(hashContent(readmeContent));
  });

  it("prioritizes SKILL.md over README.md if both exist in a directory", () => {
    const skillDir = path.join(testDir, "dual-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    const skillContent = "# Primary Skill";
    const readmeContent = "# Secondary Readme";
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillContent, "utf8");
    fs.writeFileSync(path.join(skillDir, "README.md"), readmeContent, "utf8");

    const skills = scanSkills(testDir);
    expect(skills.length).toBe(1);
    expect(skills[0].path).toBe(path.join(skillDir, "SKILL.md"));
    expect(skills[0].contentHash).toBe(hashContent(skillContent));
  });

  it("ignores hidden files and directories such as .git and .DS_Store", () => {
    fs.writeFileSync(path.join(testDir, ".DS_Store"), "ignore me", "utf8");
    fs.mkdirSync(path.join(testDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(testDir, ".git", "SKILL.md"), "# Not a skill", "utf8");

    const skillContent = "# Visible Skill";
    fs.writeFileSync(path.join(testDir, "visible.md"), skillContent, "utf8");

    const skills = scanSkills(testDir);
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("visible");
  });

  it("returns empty array when directory does not exist or is not a directory", () => {
    expect(scanSkills(path.join(testDir, "nonexistent"))).toEqual([]);

    const filePath = path.join(testDir, "plain-file.txt");
    fs.writeFileSync(filePath, "hello", "utf8");
    expect(scanSkills(filePath)).toEqual([]);
  });

  it("sorts scanned skills deterministically by name", () => {
    fs.writeFileSync(path.join(testDir, "zebra.md"), "# Zebra", "utf8");
    fs.writeFileSync(path.join(testDir, "alpha.md"), "# Alpha", "utf8");
    fs.writeFileSync(path.join(testDir, "middle.md"), "# Middle", "utf8");

    const skills = scanSkills(testDir);
    expect(skills.map((s) => s.name)).toEqual(["alpha", "middle", "zebra"]);
  });
});
