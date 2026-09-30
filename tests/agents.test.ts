import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_AGENTS,
  detectAgents,
  filterAgents,
  getAgentProfiles,
  readInstalledMcpServers,
  readInstalledPlugins,
  registerAgentProfile,
  resetAgentProfiles,
  saveCustomAgent,
  scanSkills,
  stripJsonComments,
  unregisterAgentProfile,
  type DetectedAgent
} from "../packages/core/src/core/agents/index.ts";
import { AgentProfileSchema, ManifestSchema, type AgentProfile, type Manifest } from "../packages/core/src/types/index.ts";
import { hashContent } from "../packages/core/src/utils/crypto.ts";

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

  it("deep freezes DEFAULT_AGENTS and its nested objects", () => {
    expect(Object.isFrozen(DEFAULT_AGENTS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_AGENTS.opencode)).toBe(true);
    expect(Object.isFrozen(DEFAULT_AGENTS.opencode.mcpConfig)).toBe(true);
    expect(Object.isFrozen(DEFAULT_AGENTS.opencode.mcpConfig?.paths)).toBe(true);
    expect(Object.isFrozen(DEFAULT_AGENTS.opencode.skills)).toBe(true);
    expect(Object.isFrozen(DEFAULT_AGENTS.opencode.skills?.paths)).toBe(true);

    expect(() => {
      (DEFAULT_AGENTS as Record<string, unknown>).newAgent = { name: "Hacker" };
    }).toThrow();

    expect(() => {
      (DEFAULT_AGENTS.opencode as { name: string }).name = "Hacked OpenCode";
    }).toThrow();

    expect(() => {
      (DEFAULT_AGENTS.opencode.mcpConfig?.paths as string[]).push("/tmp/hack.json");
    }).toThrow();
  });
});

describe("Custom Agent Management", () => {
  const testDir = path.join(os.tmpdir(), "smcp-agents-test-" + Date.now());
  const customAgentsFile = path.join(testDir, "custom-agents.json");

  beforeEach(() => {
    resetAgentProfiles();
    process.env.SMCP_CUSTOM_AGENTS_PATH = customAgentsFile;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    resetAgentProfiles();
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

  it("recovers and filters out invalid profiles when custom-agents.json contains null or invalid schema", () => {
    fs.mkdirSync(testDir, { recursive: true });
    const content = {
      badAgentNull: null,
      badAgentString: "not-an-object",
      badAgentNoName: { mcpConfig: null, skills: null },
      badAgentWrongTypes: { name: 12345, mcpConfig: "invalid" },
      goodAgent: {
        name: "Good Custom Agent",
        mcpConfig: { paths: ["/path/good.json"], key: "mcpServers" },
        skills: null
      }
    };
    fs.writeFileSync(customAgentsFile, JSON.stringify(content), "utf8");

    const profiles = getAgentProfiles();
    expect(profiles.goodAgent).toBeDefined();
    expect(profiles.goodAgent.name).toBe("Good Custom Agent");
    expect(profiles.badAgentNull).toBeUndefined();
    expect(profiles.badAgentString).toBeUndefined();
    expect(profiles.badAgentNoName).toBeUndefined();
    expect(profiles.badAgentWrongTypes).toBeUndefined();
    expect(profiles.opencode).toBeDefined();
  });

  it("validates agent id and profile schema when saving custom agent", () => {
    const validProfile = {
      name: "Valid Agent",
      mcpConfig: null,
      skills: null
    };

    expect(() => saveCustomAgent("", validProfile)).toThrow();
    expect(() => saveCustomAgent("   ", validProfile)).toThrow();
    expect(() => saveCustomAgent("bad id with spaces", validProfile)).toThrow();
    expect(() => saveCustomAgent("bad@agent!", validProfile)).toThrow();
    expect(() => saveCustomAgent("__proto__", validProfile)).toThrow();
    expect(() => saveCustomAgent("constructor", validProfile)).toThrow();
    expect(() => saveCustomAgent("prototype", validProfile)).toThrow();

    expect(() => saveCustomAgent("valid-id", null as unknown as AgentProfile)).toThrow();
    expect(() => saveCustomAgent("valid-id", { name: 123 } as unknown as AgentProfile)).toThrow();
    expect(() =>
      saveCustomAgent("valid-id", {
        name: "Test",
        mcpConfig: { paths: "not-an-array" }
      } as unknown as AgentProfile)
    ).toThrow();
  });

  it("saves custom agent with file mode 0o600", () => {
    saveCustomAgent("perm-agent", {
      name: "Perm Agent",
      mcpConfig: null,
      skills: null
    });

    const stat = fs.statSync(customAgentsFile);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });
});

describe("In-Memory Runtime Agent Profiles & Manifest Openness", () => {
  beforeEach(() => {
    resetAgentProfiles();
  });

  afterAll(() => {
    resetAgentProfiles();
  });

  it("registers an in-memory agent profile and includes it in getAgentProfiles()", () => {
    const runtimeProfile: AgentProfile = {
      name: "Runtime Agent",
      mcpConfig: {
        paths: ["/tmp/runtime-agent/mcp.json"],
        key: "mcpServers"
      },
      skills: {
        paths: ["/tmp/runtime-agent/skills"]
      }
    };

    registerAgentProfile("runtime-agent", runtimeProfile);

    const profiles = getAgentProfiles();
    expect(profiles["runtime-agent"]).toBeDefined();
    expect(profiles["runtime-agent"].name).toBe("Runtime Agent");
    expect(profiles["runtime-agent"].mcpConfig?.paths).toEqual(["/tmp/runtime-agent/mcp.json"]);

    // Immutability: Mutating original profile object does not affect registry
    (runtimeProfile.mcpConfig?.paths as string[]).push("/tmp/hacked.json");
    expect(getAgentProfiles()["runtime-agent"].mcpConfig?.paths).toEqual(["/tmp/runtime-agent/mcp.json"]);

    // Immutability: Mutating returned profile object does not affect registry
    profiles["runtime-agent"].name = "Mutated Local Name";
    expect(getAgentProfiles()["runtime-agent"].name).toBe("Runtime Agent");
  });

  it("overrides a default agent profile with an in-memory agent profile (highest precedence)", () => {
    expect(DEFAULT_AGENTS.opencode.name).toBe("OpenCode");

    const customOpenCode: AgentProfile = {
      name: "Custom OpenCode In-Memory",
      mcpConfig: {
        paths: ["~/.opencode-override/mcp.json"],
        key: "mcp"
      },
      skills: null
    };

    registerAgentProfile("opencode", customOpenCode);

    const profiles = getAgentProfiles();
    expect(profiles.opencode).toBeDefined();
    expect(profiles.opencode.name).toBe("Custom OpenCode In-Memory");
    expect(profiles.opencode.mcpConfig?.key).toBe("mcp");

    // Other default profiles remain intact
    expect(profiles.cursor).toBeDefined();
    expect(profiles.cursor.name).toBe("Cursor");
    expect(DEFAULT_AGENTS.opencode.name).toBe("OpenCode");
  });

  it("overrides a disk custom agent with an in-memory agent profile", () => {
    const testDir = path.join(os.tmpdir(), "smcp-inmem-precedence-" + Date.now());
    const customPath = path.join(testDir, "custom-agents.json");

    try {
      saveCustomAgent(
        "hybrid-agent",
        {
          name: "Disk Version",
          mcpConfig: null,
          skills: null
        },
        customPath
      );

      const diskProfiles = getAgentProfiles(customPath);
      expect(diskProfiles["hybrid-agent"].name).toBe("Disk Version");

      registerAgentProfile("hybrid-agent", {
        name: "In-Memory Version",
        mcpConfig: null,
        skills: null
      });

      const mergedProfiles = getAgentProfiles(customPath);
      expect(mergedProfiles["hybrid-agent"].name).toBe("In-Memory Version");
    } finally {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    }
  });

  it("unregisters an in-memory agent profile and restores default or disk agent", () => {
    registerAgentProfile("opencode", {
      name: "Temporary OpenCode",
      mcpConfig: null,
      skills: null
    });
    expect(getAgentProfiles().opencode.name).toBe("Temporary OpenCode");

    unregisterAgentProfile("opencode");
    expect(getAgentProfiles().opencode.name).toBe("OpenCode");

    registerAgentProfile("ephemeral-agent", {
      name: "Ephemeral",
      mcpConfig: null,
      skills: null
    });
    expect(getAgentProfiles()["ephemeral-agent"]).toBeDefined();

    unregisterAgentProfile("ephemeral-agent");
    expect(getAgentProfiles()["ephemeral-agent"]).toBeUndefined();

    // Calling unregister on non-existent or prototype pollution key does not throw
    expect(() => unregisterAgentProfile("non-existent")).not.toThrow();
    expect(() => unregisterAgentProfile("__proto__")).not.toThrow();
    expect(() => unregisterAgentProfile("constructor")).not.toThrow();
    expect(() => unregisterAgentProfile("prototype")).not.toThrow();
  });

  it("resets all in-memory agent profiles via resetAgentProfiles()", () => {
    registerAgentProfile("agent-one", { name: "Agent 1", mcpConfig: null, skills: null });
    registerAgentProfile("agent-two", { name: "Agent 2", mcpConfig: null, skills: null });
    registerAgentProfile("windsurf", { name: "Windsurf Overridden", mcpConfig: null, skills: null });

    let profiles = getAgentProfiles();
    expect(profiles["agent-one"]).toBeDefined();
    expect(profiles["agent-two"]).toBeDefined();
    expect(profiles.windsurf.name).toBe("Windsurf Overridden");

    resetAgentProfiles();

    profiles = getAgentProfiles();
    expect(profiles["agent-one"]).toBeUndefined();
    expect(profiles["agent-two"]).toBeUndefined();
    expect(profiles.windsurf.name).toBe("Windsurf");
  });

  it("validates agent ID and rejects prototype pollution keys", () => {
    const validProfile: AgentProfile = {
      name: "Test Agent",
      mcpConfig: null,
      skills: null
    };

    expect(() => registerAgentProfile("__proto__", validProfile)).toThrow(/Invalid agent ID/);
    expect(() => registerAgentProfile("constructor", validProfile)).toThrow(/Invalid agent ID/);
    expect(() => registerAgentProfile("prototype", validProfile)).toThrow(/Invalid agent ID/);
    expect(() => registerAgentProfile("", validProfile)).toThrow(/Invalid agent ID/);
    expect(() => registerAgentProfile("   ", validProfile)).toThrow(/Invalid agent ID/);
    expect(() => registerAgentProfile("invalid spaces", validProfile)).toThrow(/Invalid agent ID/);
    expect(() => registerAgentProfile("invalid@char!", validProfile)).toThrow(/Invalid agent ID/);
    expect(() => registerAgentProfile(123 as unknown as string, validProfile)).toThrow(/Invalid agent ID/);

    expect(() =>
      registerAgentProfile("valid-agent", { name: 123 } as unknown as AgentProfile)
    ).toThrow();
  });

  it("preserves arbitrary keys on ManifestSchema due to .passthrough()", () => {
    const customManifest = {
      name: "extensible-pack",
      version: "1.0.0",
      description: "Pack with arbitrary metadata",
      customMetadata: {
        packAuthorId: "auth_12345",
        features: ["ai", "mcp"]
      },
      tags: ["extensible", "community"],
      experimentalFlag: true,
      arbitraryNumber: 42
    };

    const parsed = ManifestSchema.parse(customManifest);

    expect(parsed.name).toBe("extensible-pack");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.customMetadata).toEqual({
      packAuthorId: "auth_12345",
      features: ["ai", "mcp"]
    });
    expect(parsed.tags).toEqual(["extensible", "community"]);
    expect(parsed.experimentalFlag).toBe(true);
    expect(parsed.arbitraryNumber).toBe(42);

    // Verify Manifest interface typing accepts arbitrary keys
    const manifestTyped: Manifest = parsed;
    expect(manifestTyped["customMetadata"]).toEqual({
      packAuthorId: "auth_12345",
      features: ["ai", "mcp"]
    });
    expect(manifestTyped["experimentalFlag"]).toBe(true);
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

  it("rejects directories as mcp config files and regular files as skills directories", () => {
    const fakeMcpDir = path.join(testDir, "fake-mcp-dir");
    fs.mkdirSync(fakeMcpDir, { recursive: true });

    const fakeSkillsFile = path.join(testDir, "fake-skills-file.txt");
    fs.writeFileSync(fakeSkillsFile, "not a directory", "utf8");

    const mockProfiles = {
      invalidTypesAgent: {
        name: "Invalid Types Agent",
        mcpConfig: { paths: [fakeMcpDir], key: "mcpServers" },
        skills: { paths: [fakeSkillsFile] }
      }
    };

    const detected = detectAgents(mockProfiles);
    expect(detected).toEqual([]);
  });

  it("handles null or non-object profiles gracefully without throwing", () => {
    const mockProfiles = {
      nullProfile: null as unknown as AgentProfile,
      stringProfile: "string" as unknown as AgentProfile,
      validAgent: {
        name: "Valid Agent",
        mcpConfig: null,
        skills: null
      }
    };

    const detected = detectAgents(mockProfiles);
    expect(detected).toEqual([]);
  });

  it("detects an agent when only pluginsDirPath directory exists", () => {
    const pluginDir = path.join(os.tmpdir(), "smcp-plugins-only-" + Date.now());
    fs.mkdirSync(pluginDir, { recursive: true });

    try {
      const mockProfiles: Record<string, AgentProfile> = {
        "custom-plugin-agent": {
          name: "Plugin Only Agent",
          plugins: {
            key: "plugin",
            format: "array",
            paths: [],
            dirPaths: [pluginDir]
          }
        }
      };

      const detected = detectAgents(mockProfiles);
      expect(detected.length).toBe(1);
      expect(detected[0].id).toBe("custom-plugin-agent");
      expect(detected[0].pluginsDirPath).toBe(pluginDir);
    } finally {
      if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      }
    }
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

  it("rejects prototype pollution keys __proto__, constructor, and prototype", () => {
    const configPath = path.join(testDir, "pollution-keys.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          validServer: { command: "node", args: ["server.js"] },
          __proto__: { command: "evil" },
          constructor: { command: "evil" },
          prototype: { command: "evil" }
        },
        __proto__: { evil: true },
        constructor: { evil: true },
        prototype: { evil: true }
      }),
      "utf8"
    );

    expect(readInstalledMcpServers(configPath, "__proto__")).toEqual({});
    expect(readInstalledMcpServers(configPath, "constructor")).toEqual({});
    expect(readInstalledMcpServers(configPath, "prototype")).toEqual({});

    const servers = readInstalledMcpServers(configPath, "mcpServers");
    expect(servers.validServer).toBeDefined();
    expect(servers.validServer.command).toBe("node");
    expect(Object.hasOwn(servers, "__proto__")).toBe(false);
    expect(Object.hasOwn(servers, "constructor")).toBe(false);
    expect(Object.hasOwn(servers, "prototype")).toBe(false);
    expect(Object.keys(servers)).toEqual(["validServer"]);
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

  it("follows symlinked directories and symlinked markdown files", () => {
    const externalDir = path.join(os.tmpdir(), "smcp-external-skills-" + Date.now());
    fs.mkdirSync(externalDir, { recursive: true });

    try {
      const extSkillDir = path.join(externalDir, "ext-skill");
      fs.mkdirSync(extSkillDir, { recursive: true });
      fs.writeFileSync(path.join(extSkillDir, "SKILL.md"), "# External Symlinked Skill", "utf8");

      const extMdFile = path.join(externalDir, "standalone-ext.md");
      fs.writeFileSync(extMdFile, "# Standalone Ext", "utf8");

      fs.symlinkSync(extSkillDir, path.join(testDir, "symlinked-dir"));
      fs.symlinkSync(extMdFile, path.join(testDir, "symlinked-file.md"));
      fs.symlinkSync(path.join(externalDir, "does-not-exist"), path.join(testDir, "broken-link"));

      const skills = scanSkills(testDir);
      const names = skills.map((s) => s.name);
      expect(names).toContain("symlinked-dir");
      expect(names).toContain("symlinked-file");
      expect(names).not.toContain("broken-link");

      const dirSkill = skills.find((s) => s.name === "symlinked-dir");
      expect(dirSkill?.path).toBe(path.join(testDir, "symlinked-dir", "SKILL.md"));
      expect(dirSkill?.description).toBe("Skill in symlinked-dir");

      const fileSkill = skills.find((s) => s.name === "symlinked-file");
      expect(fileSkill?.path).toBe(path.join(testDir, "symlinked-file.md"));
    } finally {
      fs.rmSync(externalDir, { recursive: true, force: true });
    }
  });

  it("skips directories without any SKILL.md or README.md", () => {
    fs.mkdirSync(path.join(testDir, "empty-folder"), { recursive: true });

    const randomDir = path.join(testDir, "random-folder");
    fs.mkdirSync(randomDir, { recursive: true });
    fs.writeFileSync(path.join(randomDir, "other.txt"), "hello", "utf8");
    fs.writeFileSync(path.join(randomDir, "script.js"), "console.log('hi')", "utf8");

    const validDir = path.join(testDir, "valid-skill");
    fs.mkdirSync(validDir, { recursive: true });
    fs.writeFileSync(path.join(validDir, "SKILL.md"), "# Valid Skill", "utf8");

    const skills = scanSkills(testDir);
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("valid-skill");
  });

  it("supports case variations: SKILL.md, skill.md, README.md, and readme.md", () => {
    const dir1 = path.join(testDir, "lowercase-skill");
    fs.mkdirSync(dir1, { recursive: true });
    fs.writeFileSync(path.join(dir1, "skill.md"), "# Lower Skill", "utf8");

    const dir2 = path.join(testDir, "lowercase-readme");
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(path.join(dir2, "readme.md"), "# Lower Readme", "utf8");

    const dir3 = path.join(testDir, "uppercase-skill");
    fs.mkdirSync(dir3, { recursive: true });
    fs.writeFileSync(path.join(dir3, "SKILL.md"), "# Upper Skill", "utf8");

    const dir4 = path.join(testDir, "uppercase-readme");
    fs.mkdirSync(dir4, { recursive: true });
    fs.writeFileSync(path.join(dir4, "README.md"), "# Upper Readme", "utf8");

    const skills = scanSkills(testDir);
    const names = skills.map((s) => s.name);
    expect(names).toEqual([
      "lowercase-readme",
      "lowercase-skill",
      "uppercase-readme",
      "uppercase-skill"
    ]);

    const s1 = skills.find((s) => s.name === "lowercase-skill");
    expect(s1?.path).toBe(path.join(dir1, "skill.md"));

    const s2 = skills.find((s) => s.name === "lowercase-readme");
    expect(s2?.path).toBe(path.join(dir2, "readme.md"));

    const s3 = skills.find((s) => s.name === "uppercase-skill");
    expect(s3?.path).toBe(path.join(dir3, "SKILL.md"));

    const s4 = skills.find((s) => s.name === "uppercase-readme");
    expect(s4?.path).toBe(path.join(dir4, "README.md"));
  });
});

describe("stripJsonComments()", () => {
  it("strips single-line and multi-line comments", () => {
    const input = `{\n  // single line comment\n  "key": "value",\n  /* multi\n     line */\n  "count": 42\n}`;
    const cleaned = stripJsonComments(input);
    const parsed = JSON.parse(cleaned);
    expect(parsed.key).toBe("value");
    expect(parsed.count).toBe(42);
  });

  it("preserves URLs and escaped strings containing slashes and asterisks", () => {
    const input = `{\n  "url": "https://mcp.grep.app/query//test/*abc",\n  "name": "grep"\n}`;
    const cleaned = stripJsonComments(input);
    const parsed = JSON.parse(cleaned);
    expect(parsed.url).toBe("https://mcp.grep.app/query//test/*abc");
  });

  it("strips trailing commas in objects and arrays", () => {
    const input = `{\n  "items": [\n    "one",\n    "two",\n  ],\n  "done": true,\n}`;
    const cleaned = stripJsonComments(input);
    const parsed = JSON.parse(cleaned);
    expect(parsed.items).toEqual(["one", "two"]);
    expect(parsed.done).toBe(true);
  });

  it("preserves commas inside string literals even when followed by brackets", () => {
    const input = `{\n  "msg": "Hello, world,}",\n  "pattern": "array[,]",\n  "trailing": true,\n}`;
    const cleaned = stripJsonComments(input);
    const parsed = JSON.parse(cleaned);
    expect(parsed.msg).toBe("Hello, world,}");
    expect(parsed.pattern).toBe("array[,]");
    expect(parsed.trailing).toBe(true);
  });
});

describe("filterAgents()", () => {
  const agents: DetectedAgent[] = [
    { id: "opencode", name: "OpenCode", mcpConfigPath: "/p/opencode.jsonc", skillsDirPath: "/p/skills" },
    { id: "claude-code", name: "Claude Code", mcpConfigPath: "/p/claude.json", skillsDirPath: "/p/claude-skills" },
    { id: "claude-desktop", name: "Claude Desktop", mcpConfigPath: "/p/desktop.json", skillsDirPath: null },
    { id: "cursor", name: "Cursor", mcpConfigPath: "/p/cursor.json", skillsDirPath: "/p/cursor-skills" }
  ];

  it("returns all agents when filter is omitted or empty", () => {
    expect(filterAgents(agents)).toEqual(agents);
    expect(filterAgents(agents, [])).toEqual(agents);
    expect(filterAgents(agents, ["   "])).toEqual(agents);
  });

  it("filters by exact agent id", () => {
    const filtered = filterAgents(agents, ["opencode"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("opencode");
  });

  it("filters with friendly alias 'claude' matching both claude-code and claude-desktop", () => {
    const filtered = filterAgents(agents, ["claude"]);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((a) => a.id)).toEqual(["claude-code", "claude-desktop"]);
  });

  it("supports comma-separated string inputs and case-insensitivity", () => {
    const filtered = filterAgents(agents, ["CLAUDE-CODE,OPENCODE"]);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((a) => a.id)).toEqual(["opencode", "claude-code"]);
  });

  it("supports name matching", () => {
    const filtered = filterAgents(agents, ["Cursor"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("cursor");
  });
});

describe("readInstalledMcpServers() JSONC & OpenCode support", () => {
  const testDir = path.join(os.tmpdir(), "smcp-jsonc-test-" + Date.now());

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

  it("parses OpenCode jsonc with comments and array-formatted commands", () => {
    const configPath = path.join(testDir, "opencode.jsonc");
    const jsoncContent = `{\n  // OpenCode MCP config\n  "mcp": {\n    "context7": {\n      "type": "local",\n      "command": ["bunx", "-y", "@upstash/context7-mcp", "--api-key", "secret-key"],\n      "enabled": true\n    },\n    "servers": {\n      "grep": {\n        "type": "remote",\n        "url": "https://mcp.grep.app"\n      }\n    }\n  }\n}`;
    fs.writeFileSync(configPath, jsoncContent, "utf8");

    const servers = readInstalledMcpServers(configPath);
    expect(servers.context7).toBeDefined();
    expect(servers.context7.command).toBe("bunx");
    expect(servers.context7.args).toEqual(["-y", "@upstash/context7-mcp", "--api-key", "secret-key"]);
    expect(servers.grep).toBeDefined();
    expect(servers.grep.url).toBe("https://mcp.grep.app");
  });
});

describe("readInstalledPlugins & Agent Plugins", () => {
  const pluginTestDir = path.join(os.tmpdir(), "smcp-plugin-test-" + Date.now());

  beforeEach(() => {
    if (fs.existsSync(pluginTestDir)) {
      fs.rmSync(pluginTestDir, { recursive: true, force: true });
    }
    fs.mkdirSync(pluginTestDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(pluginTestDir)) {
      fs.rmSync(pluginTestDir, { recursive: true, force: true });
    }
  });

  it("reads array format plugins from OpenCode JSONC (plugin and plugins keys)", () => {
    const opencodePath = path.join(pluginTestDir, "opencode.jsonc");
    fs.writeFileSync(
      opencodePath,
      `{\n  // plugins comment\n  "plugin": ["opencode-gemini-auth@latest", "./plugin/antigravity.ts"]\n}`,
      "utf8"
    );

    const plugins = readInstalledPlugins(opencodePath, "plugin", "array");
    expect(plugins).toHaveLength(2);
    expect(plugins.map((p) => (typeof p === "string" ? p : p.name))).toEqual([
      "opencode-gemini-auth@latest",
      "./plugin/antigravity.ts"
    ]);
  });

  it("reads map format plugins from Claude Code settings.json (enabledPlugins)", () => {
    const claudePath = path.join(pluginTestDir, "settings.json");
    fs.writeFileSync(
      claudePath,
      JSON.stringify({
        enabledPlugins: {
          "superpowers@claude-plugins-official": true,
          "disabled-plugin": false
        }
      }),
      "utf8"
    );

    const plugins = readInstalledPlugins(claudePath, "enabledPlugins", "map");
    expect(plugins).toHaveLength(1);
    expect(plugins.map((p) => (typeof p === "string" ? p : p.name))).toEqual([
      "superpowers@claude-plugins-official"
    ]);
  });

  it("populates pluginsConfigPath and pluginsDirPath in detectAgents", () => {
    const detected = detectAgents();
    const opencodeAgent = detected.find((a) => a.id === "opencode");
    expect(opencodeAgent).toBeDefined();
    expect(opencodeAgent?.pluginsConfigPath).toBeDefined();
  });

  it("readInstalledPlugins returns empty array on invalid inputs or missing files", () => {
    expect(readInstalledPlugins("")).toEqual([]);
    expect(readInstalledPlugins("/non/existent/config.json")).toEqual([]);

    const corruptPath = path.join(pluginTestDir, "bad.json");
    fs.writeFileSync(corruptPath, "{ corrupt json syntax", "utf8");
    expect(readInstalledPlugins(corruptPath)).toEqual([]);

    const nonObjectPath = path.join(pluginTestDir, "array.json");
    fs.writeFileSync(nonObjectPath, JSON.stringify(["just", "an", "array"]), "utf8");
    expect(readInstalledPlugins(nonObjectPath)).toEqual([]);
  });

  it("readInstalledPlugins resolves existing local file paths for relative plugin entries", () => {
    const localPluginDir = path.join(pluginTestDir, "plugin");
    fs.mkdirSync(localPluginDir, { recursive: true });
    const localPluginFile = path.join(localPluginDir, "my-tool.ts");
    fs.writeFileSync(localPluginFile, "export default {};", "utf8");

    const confPath = path.join(pluginTestDir, "opencode-local.json");
    fs.writeFileSync(
      confPath,
      JSON.stringify({
        plugin: ["./plugin/my-tool.ts", "./plugin/missing-tool.ts"]
      }),
      "utf8"
    );

    const plugins = readInstalledPlugins(confPath, "plugin", "array");
    expect(plugins).toHaveLength(2);
    expect(plugins[0].name).toBe("./plugin/my-tool.ts");
    expect(plugins[0].path).toBe(localPluginFile);
    expect(plugins[1].name).toBe("./plugin/missing-tool.ts");
    expect(plugins[1].path).toBeUndefined();
  });

  it("readInstalledPlugins ignores prototype pollution keys in map format", () => {
    const mapPath = path.join(pluginTestDir, "pollution.json");
    fs.writeFileSync(
      mapPath,
      JSON.stringify({
        enabledPlugins: {
          __proto__: true,
          constructor: true,
          prototype: true,
          "valid-plugin": true
        }
      }),
      "utf8"
    );

    const plugins = readInstalledPlugins(mapPath, "enabledPlugins", "map");
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("valid-plugin");
  });

  it("readInstalledPlugins supports fallback 'plugins' key in array format", () => {
    const confPath = path.join(pluginTestDir, "fallback-plural.json");
    fs.writeFileSync(
      confPath,
      JSON.stringify({
        plugins: ["plural-plugin-1", "plural-plugin-2"]
      }),
      "utf8"
    );

    const plugins = readInstalledPlugins(confPath, "plugin", "array");
    expect(plugins).toHaveLength(2);
    expect(plugins.map((p) => p.name)).toEqual(["plural-plugin-1", "plural-plugin-2"]);
  });
});
