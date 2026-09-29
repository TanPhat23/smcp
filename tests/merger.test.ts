import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatServerForAgent,
  getMcpAdapter,
  installPluginFiles,
  installSkillFiles,
  mergeMcpServersIntoFile,
  mergePluginsIntoFile,
  registerMcpAdapter,
  resetMcpAdapters,
  unregisterMcpAdapter
} from "../src/core/merger/index.ts";
import { stripJsonComments } from "../src/core/agents/index.ts";
import type { McpAdapter, McpServerConfig } from "../src/types/index.ts";

describe("Config Merger (mergeMcpServersIntoFile)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-merger-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("merges new servers into an existing json config under default mcpKey 'mcpServers'", () => {
    const configPath = path.join(testDir, "opencode.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          theme: "dark",
          mcpServers: {
            existingServer: { command: "node", args: ["server.js"] }
          }
        },
        null,
        2
      ) + "\n"
    );

    const newServers: Record<string, McpServerConfig> = {
      newServer: { command: "npx", args: ["-y", "new-server"] }
    };

    mergeMcpServersIntoFile(configPath, newServers);

    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(updated.theme).toBe("dark");
    expect(updated.mcpServers.existingServer).toEqual({ command: "node", args: ["server.js"] });
    expect(updated.mcpServers.newServer).toEqual({ command: "npx", args: ["-y", "new-server"] });
  });

  it("preserves other top-level keys like theme, models, and custom settings", () => {
    const configPath = path.join(testDir, "custom-config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          theme: "solarized-light",
          models: ["gemini-pro", "claude-3-opus"],
          userPreferences: { autostart: true },
          mcpServers: {
            server1: { command: "node", args: ["server1.js"] }
          }
        },
        null,
        2
      ) + "\n"
    );

    mergeMcpServersIntoFile(configPath, {
      server2: { command: "python", args: ["server2.py"] }
    });

    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(updated.theme).toBe("solarized-light");
    expect(updated.models).toEqual(["gemini-pro", "claude-3-opus"]);
    expect(updated.userPreferences).toEqual({ autostart: true });
    expect(updated.mcpServers.server1).toEqual({ command: "node", args: ["server1.js"] });
    expect(updated.mcpServers.server2).toEqual({ command: "python", args: ["server2.py"] });
  });

  it("merges servers under a custom configured mcpKey", () => {
    const configPath = path.join(testDir, "agent-config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          version: "1.0",
          customMcp: {
            existingServer: { command: "node", args: ["old.js"] }
          }
        },
        null,
        2
      ) + "\n"
    );

    mergeMcpServersIntoFile(
      configPath,
      {
        addedServer: { command: "bun", args: ["new.js"] }
      },
      "customMcp"
    );

    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(updated.version).toBe("1.0");
    expect(updated.customMcp.existingServer).toEqual({ command: "node", args: ["old.js"] });
    expect(updated.customMcp.addedServer).toEqual({ command: "bun", args: ["new.js"] });
  });

  it("merges servers into OpenCode config using 'mcp' key and McpLocalConfig format", () => {
    const configPath = path.join(testDir, "opencode-native.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "sequential-thinking": {
              type: "local",
              command: ["bunx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
              enabled: true
            }
          }
        },
        null,
        2
      ) + "\n"
    );

    mergeMcpServersIntoFile(configPath, {
      "sequential-thinking": {
        command: "bunx",
        args: ["-y", "@modelcontextprotocol/server-sequential-thinking"]
      },
      "new-local": {
        command: "npx",
        args: ["-y", "new-mcp"],
        env: { FOO: "bar" }
      },
      "new-remote": {
        url: "https://mcp.example.com"
      }
    });

    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(updated.mcp["sequential-thinking"]).toEqual({
      type: "local",
      command: ["bunx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
      enabled: true
    });
    expect(updated.mcp["new-local"]).toEqual({
      type: "local",
      command: ["npx", "-y", "new-mcp"],
      environment: { FOO: "bar" },
      enabled: true
    });
    expect(updated.mcp["new-remote"]).toEqual({
      type: "remote",
      url: "https://mcp.example.com",
      enabled: true
    });
  });

  it("formatServerForAgent converts between standard MCP and OpenCode schemas safely", () => {
    // OpenCode local
    const ocLocal = formatServerForAgent(
      { command: "bunx", args: ["-y", "tool"], env: { SECRET: "1" } },
      "mcp",
      "/path/to/opencode.jsonc"
    );
    expect(ocLocal.type).toBe("local");
    expect(ocLocal.command).toEqual(["bunx", "-y", "tool"]);
    expect(ocLocal.environment).toEqual({ SECRET: "1" });
    expect(ocLocal.enabled).toBe(true);
    expect((ocLocal as any).args).toBeUndefined();
    expect((ocLocal as any).env).toBeUndefined();

    // OpenCode remote
    const ocRemote = formatServerForAgent(
      { url: "https://remote.mcp" },
      "mcp",
      "/path/to/opencode.jsonc"
    );
    expect(ocRemote.type).toBe("remote");
    expect(ocRemote.url).toBe("https://remote.mcp");
    expect(ocRemote.enabled).toBe(true);

    // Standard Claude Code / Cursor format
    const claudeLocal = formatServerForAgent(
      { command: ["npx", "run-tool"] as any, environment: { KEY: "VAL" } as any },
      "mcpServers",
      "/home/user/.claude.json"
    );
    expect(claudeLocal.command).toBe("npx");
    expect(claudeLocal.args).toEqual(["run-tool"]);
    expect(claudeLocal.env).toEqual({ KEY: "VAL" });
    expect((claudeLocal as any).environment).toBeUndefined();
  });

  it("extensible MCP adapter registry supports custom agent formats and lifecycle", () => {
    try {
      const customAdapter: McpAdapter = {
        name: "custom-agent-format",
        matches: (ctx) => ctx.format === "custom-agent" || ctx.agentId === "custom-agent",
        serialize: (cfg, _ctx, existing) => {
          return {
            binary: cfg.command || "unknown",
            parameters: cfg.args || [],
            customTag: "v1",
            ...(existing && typeof existing === "object" ? existing : {})
          };
        },
        deserialize: (raw) => {
          return {
            command: String(raw.binary || ""),
            args: Array.isArray(raw.parameters) ? raw.parameters.map(String) : []
          };
        }
      };

      registerMcpAdapter(customAdapter);

      // Verify retrieval by name
      const retrieved = getMcpAdapter("custom-agent-format");
      expect(retrieved.name).toBe("custom-agent-format");

      // Verify retrieval by context
      const byCtx = getMcpAdapter({ format: "custom-agent" });
      expect(byCtx.name).toBe("custom-agent-format");

      // Test serialization through mergeMcpServersIntoFile with options object
      const configPath = path.join(testDir, "custom-agent-conf.json");
      fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }), "utf8");

      mergeMcpServersIntoFile(
        configPath,
        {
          myServer: { command: "custom-bin", args: ["--flag", "val"] }
        },
        {
          mcpKey: "mcpServers",
          format: "custom-agent",
          agentId: "custom-agent"
        }
      );

      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(parsed.mcpServers.myServer).toEqual({
        binary: "custom-bin",
        parameters: ["--flag", "val"],
        customTag: "v1"
      });

      // Test deserialization
      const canon = retrieved.deserialize(parsed.mcpServers.myServer);
      expect(canon.command).toBe("custom-bin");
      expect(canon.args).toEqual(["--flag", "val"]);

      // Test unregistering
      expect(unregisterMcpAdapter("custom-agent-format")).toBe(true);
      const fallback = getMcpAdapter({ format: "custom-agent" });
      expect(fallback.name).toBe("standard");

      // Test prototype pollution protection
      expect(() =>
        registerMcpAdapter({
          name: "__proto__",
          matches: () => false,
          serialize: () => ({}),
          deserialize: () => ({})
        })
      ).toThrow(/Invalid adapter name/);
    } finally {
      resetMcpAdapters();
    }
  });

  it("overwrites an existing server when the server name already exists", () => {
    const configPath = path.join(testDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            sharedServer: { command: "node", args: ["v1.js"] }
          }
        },
        null,
        2
      ) + "\n"
    );

    mergeMcpServersIntoFile(configPath, {
      sharedServer: { command: "node", args: ["v2.js"] }
    });

    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(updated.mcpServers.sharedServer).toEqual({ command: "node", args: ["v2.js"] });
  });

  it("creates the file and all parent directories if they do not exist", () => {
    const deepConfigPath = path.join(testDir, "nested", "deep", "dir", "mcp.json");
    expect(fs.existsSync(deepConfigPath)).toBe(false);

    mergeMcpServersIntoFile(deepConfigPath, {
      freshServer: { command: "uvx", args: ["mcp-server"] }
    });

    expect(fs.existsSync(deepConfigPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(deepConfigPath, "utf8"));
    expect(content.mcpServers.freshServer).toEqual({ command: "uvx", args: ["mcp-server"] });
  });

  it("recovers gracefully from malformed/corrupt JSON in existing file and creates clean config", () => {
    const configPath = path.join(testDir, "corrupt.json");
    fs.writeFileSync(configPath, "{ invalid json content !!!", "utf8");

    mergeMcpServersIntoFile(configPath, {
      recoveredServer: { command: "node", args: ["recovered.js"] }
    });

    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(updated.mcpServers.recoveredServer).toEqual({
      command: "node",
      args: ["recovered.js"]
    });
  });

  it("recovers gracefully from empty file or non-object JSON values", () => {
    const emptyConfigPath = path.join(testDir, "empty.json");
    fs.writeFileSync(emptyConfigPath, "", "utf8");

    mergeMcpServersIntoFile(emptyConfigPath, {
      s1: { command: "node" }
    });
    expect(JSON.parse(fs.readFileSync(emptyConfigPath, "utf8"))).toEqual({
      mcpServers: { s1: { command: "node" } }
    });

    const arrayConfigPath = path.join(testDir, "array.json");
    fs.writeFileSync(arrayConfigPath, JSON.stringify(["not", "an", "object"]), "utf8");

    mergeMcpServersIntoFile(arrayConfigPath, {
      s2: { command: "python" }
    });
    expect(JSON.parse(fs.readFileSync(arrayConfigPath, "utf8"))).toEqual({
      mcpServers: { s2: { command: "python" } }
    });
  });

  it("recovers gracefully when existing mcpKey value is not an object", () => {
    const configPath = path.join(testDir, "bad-key.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ theme: "dark", mcpServers: "not-an-object" }),
      "utf8"
    );

    mergeMcpServersIntoFile(configPath, {
      repaired: { command: "bun" }
    });

    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(updated.theme).toBe("dark");
    expect(updated.mcpServers).toEqual({ repaired: { command: "bun" } });
  });

  it("rejects prototype pollution keys __proto__, constructor, and prototype in mcpKey", () => {
    const configPath = path.join(testDir, "pollution.json");
    fs.writeFileSync(configPath, "{}", "utf8");

    expect(() => {
      mergeMcpServersIntoFile(configPath, { evil: { command: "bad" } }, "__proto__");
    }).toThrow(/Invalid mcpKey/);

    expect(() => {
      mergeMcpServersIntoFile(configPath, { evil: { command: "bad" } }, "constructor");
    }).toThrow(/Invalid mcpKey/);

    expect(() => {
      mergeMcpServersIntoFile(configPath, { evil: { command: "bad" } }, "prototype");
    }).toThrow(/Invalid mcpKey/);

    expect((Object.prototype as any).evil).toBeUndefined();
  });

  it("ignores prototype pollution keys __proto__, constructor, and prototype in newServers", () => {
    const configPath = path.join(testDir, "server-pollution.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          existingServer: { command: "node" }
        }
      }),
      "utf8"
    );

    const pollutedInput: Record<string, McpServerConfig> = {
      validServer: { command: "valid-cmd" }
    };
    Object.defineProperty(pollutedInput, "__proto__", {
      value: { command: "evil-proto" },
      enumerable: true,
      configurable: true
    });
    pollutedInput.constructor = { command: "evil-constructor" } as any;
    pollutedInput.prototype = { command: "evil-prototype" } as any;

    mergeMcpServersIntoFile(configPath, pollutedInput);

    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(updated.mcpServers.existingServer).toEqual({ command: "node" });
    expect(updated.mcpServers.validServer).toEqual({ command: "valid-cmd" });
    expect(Object.hasOwn(updated.mcpServers, "__proto__")).toBe(false);
    expect(Object.hasOwn(updated.mcpServers, "constructor")).toBe(false);
    expect(Object.hasOwn(updated.mcpServers, "prototype")).toBe(false);
    expect(Object.keys(updated.mcpServers).sort()).toEqual(["existingServer", "validServer"]);
    expect((Object.prototype as any).command).toBeUndefined();
  });

  it("ensures atomic write without leaving temporary files on success", () => {
    const configPath = path.join(testDir, "atomic-config.json");

    mergeMcpServersIntoFile(configPath, {
      testServer: { command: "node" }
    });

    expect(fs.existsSync(configPath)).toBe(true);
    const files = fs.readdirSync(testDir);
    expect(files).toContain("atomic-config.json");
    const tmpFiles = files.filter((f) => f.includes(".tmp"));
    expect(tmpFiles.length).toBe(0);
  });

  it("ensures atomic write leaves existing file valid and intact even if interrupted", () => {
    const configPath = path.join(testDir, "safe-atomic.json");
    const initialContent = JSON.stringify({ theme: "dark", mcpServers: { old: { command: "cmd" } } }, null, 2) + "\n";
    fs.writeFileSync(configPath, initialContent, "utf8");

    const originalRenameSync = fs.renameSync;
    try {
      fs.renameSync = () => {
        throw new Error("Simulated interruption during rename");
      };

      expect(() => {
        mergeMcpServersIntoFile(configPath, {
          newServer: { command: "new-cmd" }
        });
      }).toThrow(/Simulated interruption/);

      // Verify the file was not corrupted or modified
      const currentContent = fs.readFileSync(configPath, "utf8");
      expect(currentContent).toBe(initialContent);

      // Verify no temporary files remain
      const files = fs.readdirSync(testDir);
      const tmpFiles = files.filter((f) => f.includes(".tmp"));
      expect(tmpFiles.length).toBe(0);
    } finally {
      fs.renameSync = originalRenameSync;
    }
  });

  it("preserves 2-space indentation formatting and adds trailing newline", () => {
    const configPath = path.join(testDir, "formatted.json");

    mergeMcpServersIntoFile(configPath, {
      formattedServer: { command: "node", args: ["run.js"] }
    });

    const raw = fs.readFileSync(configPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "mcpServers": {');
    expect(raw).toContain('    "formattedServer": {');
    expect(raw).toContain('      "command": "node",');
    expect(raw).toContain('      "args": [\n        "run.js"\n      ]');
  });

  it("preserves symlink target when updating symlinked config file", () => {
    const actualConfigPath = path.join(testDir, "actual-config.json");
    const symlinkConfigPath = path.join(testDir, "symlink-config.json");

    fs.writeFileSync(
      actualConfigPath,
      JSON.stringify(
        {
          mcpServers: {
            existingServer: { command: "node", args: ["existing.js"] }
          }
        },
        null,
        2
      ) + "\n"
    );

    fs.symlinkSync(actualConfigPath, symlinkConfigPath);

    expect(fs.lstatSync(symlinkConfigPath).isSymbolicLink()).toBe(true);

    mergeMcpServersIntoFile(symlinkConfigPath, {
      newServer: { command: "python", args: ["added.py"] }
    });

    // Verify symlink itself was preserved (not replaced with a regular file)
    expect(fs.lstatSync(symlinkConfigPath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(symlinkConfigPath)).toBe(fs.realpathSync(actualConfigPath));

    // Verify content was merged into the actual target file
    const targetContent = JSON.parse(fs.readFileSync(actualConfigPath, "utf8"));
    expect(targetContent.mcpServers.existingServer).toEqual({
      command: "node",
      args: ["existing.js"]
    });
    expect(targetContent.mcpServers.newServer).toEqual({
      command: "python",
      args: ["added.py"]
    });

    // Reading through the symlink returns the updated content
    const symlinkContent = JSON.parse(fs.readFileSync(symlinkConfigPath, "utf8"));
    expect(symlinkContent.mcpServers.newServer).toEqual({
      command: "python",
      args: ["added.py"]
    });
  });

  it("creates a backup file (.bak.) when existing config has corrupt/malformed JSON", () => {
    const configPath = path.join(testDir, "corrupted-test.json");
    const corruptContent = "{ this is completely broken json !!!";
    fs.writeFileSync(configPath, corruptContent, "utf8");

    mergeMcpServersIntoFile(configPath, {
      recovered: { command: "node", args: ["recovered.js"] }
    });

    const dirFiles = fs.readdirSync(testDir);
    const backupFiles = dirFiles.filter((f) => f.startsWith("corrupted-test.json.bak."));
    expect(backupFiles.length).toBe(1);

    const backupContent = fs.readFileSync(path.join(testDir, backupFiles[0]), "utf8");
    expect(backupContent).toBe(corruptContent);

    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(updated.mcpServers.recovered).toEqual({
      command: "node",
      args: ["recovered.js"]
    });
  });

  it("guards against newServers being an array", () => {
    const configPath = path.join(testDir, "array-guard.json");
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }), "utf8");

    mergeMcpServersIntoFile(configPath, [{ command: "test" }] as unknown as Record<string, McpServerConfig>);

    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(updated.mcpServers).toEqual({});
  });

  it("preserves existing file permissions when updating config", () => {
    if (process.platform === "win32") return;
    const configPath = path.join(testDir, "mode-config.json");
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
    fs.chmodSync(configPath, 0o600);

    mergeMcpServersIntoFile(configPath, {
      testServer: { command: "node" }
    });

    const stat = fs.statSync(configPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe("Skill File Installer (installSkillFiles)", () => {
  let testDir: string;
  let skillsBaseDir: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-skills-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    skillsBaseDir = path.join(testDir, "skills");
    fs.mkdirSync(skillsBaseDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("installs single skill file into skillsBaseDir/<skillName>/<filename>", () => {
    installSkillFiles(skillsBaseDir, "my-skill", {
      "SKILL.md": "# My Skill\nInstruction contents"
    });

    const installedFile = path.join(skillsBaseDir, "my-skill", "SKILL.md");
    expect(fs.existsSync(installedFile)).toBe(true);
    expect(fs.readFileSync(installedFile, "utf8")).toBe("# My Skill\nInstruction contents");
  });

  it("installs multiple skill files and creates parent subdirectories for nested files", () => {
    installSkillFiles(skillsBaseDir, "complex-skill", {
      "SKILL.md": "# Complex Skill",
      "references/guide.md": "## Detailed Guide",
      "scripts/helpers/run.sh": "#!/bin/bash\necho hello"
    });

    const mainFile = path.join(skillsBaseDir, "complex-skill", "SKILL.md");
    const nestedDoc = path.join(skillsBaseDir, "complex-skill", "references", "guide.md");
    const deepScript = path.join(skillsBaseDir, "complex-skill", "scripts", "helpers", "run.sh");

    expect(fs.existsSync(mainFile)).toBe(true);
    expect(fs.readFileSync(mainFile, "utf8")).toBe("# Complex Skill");

    expect(fs.existsSync(nestedDoc)).toBe(true);
    expect(fs.readFileSync(nestedDoc, "utf8")).toBe("## Detailed Guide");

    expect(fs.existsSync(deepScript)).toBe(true);
    expect(fs.readFileSync(deepScript, "utf8")).toBe("#!/bin/bash\necho hello");
  });

  it("normalizes Windows-style backslashes in filenames across platforms", () => {
    installSkillFiles(skillsBaseDir, "windows-pack-skill", {
      "SKILL.md": "# Windows Pack Skill",
      "references\\nested\\guide.md": "## Nested with backslashes"
    });

    const mainFile = path.join(skillsBaseDir, "windows-pack-skill", "SKILL.md");
    const nestedDoc = path.join(skillsBaseDir, "windows-pack-skill", "references", "nested", "guide.md");

    expect(fs.existsSync(mainFile)).toBe(true);
    expect(fs.existsSync(nestedDoc)).toBe(true);
    expect(fs.readFileSync(nestedDoc, "utf8")).toBe("## Nested with backslashes");
  });

  it("creates skillsBaseDir and skill directory if they do not exist", () => {
    const freshBaseDir = path.join(testDir, "fresh-skills-dir");
    expect(fs.existsSync(freshBaseDir)).toBe(false);

    installSkillFiles(freshBaseDir, "brand-new-skill", {
      "README.md": "# Brand New"
    });

    const targetFile = path.join(freshBaseDir, "brand-new-skill", "README.md");
    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.readFileSync(targetFile, "utf8")).toBe("# Brand New");
  });

  it("rejects directory traversal in skillName with parent directory references", () => {
    expect(() => {
      installSkillFiles(skillsBaseDir, "../../etc", {
        "evil.txt": "compromised"
      });
    }).toThrow(/traversal/i);

    expect(() => {
      installSkillFiles(skillsBaseDir, "../other-dir", {
        "evil.txt": "compromised"
      });
    }).toThrow(/traversal/i);

    expect(() => {
      installSkillFiles(skillsBaseDir, "sub/../../etc", {
        "evil.txt": "compromised"
      });
    }).toThrow(/traversal/i);
  });

  it("rejects directory traversal in skillName with absolute paths", () => {
    expect(() => {
      installSkillFiles(skillsBaseDir, "/tmp/evil-skill", {
        "evil.txt": "compromised"
      });
    }).toThrow(/traversal/i);
  });

  it("rejects invalid skillName with empty string, dots only, or path separators", () => {
    expect(() => {
      installSkillFiles(skillsBaseDir, "", { "SKILL.md": "test" });
    }).toThrow(/invalid skill name/i);

    expect(() => {
      installSkillFiles(skillsBaseDir, ".", { "SKILL.md": "test" });
    }).toThrow(/invalid skill name/i);

    expect(() => {
      installSkillFiles(skillsBaseDir, "..", { "SKILL.md": "test" });
    }).toThrow(/invalid skill name/i);

    expect(() => {
      installSkillFiles(skillsBaseDir, "a/b", { "SKILL.md": "test" });
    }).toThrow(/invalid skill name/i);
  });

  it("rejects prototype pollution keys in skillName (__proto__, constructor, prototype)", () => {
    expect(() => {
      installSkillFiles(skillsBaseDir, "__proto__", { "SKILL.md": "evil" });
    }).toThrow(/invalid skill name/i);

    expect(() => {
      installSkillFiles(skillsBaseDir, "constructor", { "SKILL.md": "evil" });
    }).toThrow(/invalid skill name/i);

    expect(() => {
      installSkillFiles(skillsBaseDir, "prototype", { "SKILL.md": "evil" });
    }).toThrow(/invalid skill name/i);
  });

  it("rejects directory traversal in filenames with parent directory references", () => {
    expect(() => {
      installSkillFiles(skillsBaseDir, "my-skill", {
        "../../passwd": "root:x:0:0..."
      });
    }).toThrow(/traversal/i);

    expect(() => {
      installSkillFiles(skillsBaseDir, "my-skill", {
        "..\\..\\passwd": "root:x:0:0..."
      });
    }).toThrow(/traversal/i);

    expect(() => {
      installSkillFiles(skillsBaseDir, "my-skill", {
        "../sibling.txt": "leaked"
      });
    }).toThrow(/traversal/i);

    expect(() => {
      installSkillFiles(skillsBaseDir, "my-skill", {
        "nested/../../secret.txt": "stolen"
      });
    }).toThrow(/traversal/i);

    expect(() => {
      installSkillFiles(skillsBaseDir, "my-skill", {
        "nested\\..\\..\\secret.txt": "stolen"
      });
    }).toThrow(/traversal/i);
  });

  it("rejects directory traversal in filenames with absolute paths", () => {
    expect(() => {
      installSkillFiles(skillsBaseDir, "my-skill", {
        "/etc/passwd": "root:x:0:0..."
      });
    }).toThrow(/traversal/i);
  });

  it("ignores or rejects prototype pollution keys in filenames without polluting Object.prototype", () => {
    const files: Record<string, string> = {
      "SKILL.md": "# Safe Skill Content"
    };
    Object.defineProperty(files, "__proto__", {
      value: "evil-proto-content",
      enumerable: true,
      configurable: true
    });
    (files as any).constructor = "evil-constructor-content";
    files.prototype = "evil-prototype-content";

    installSkillFiles(skillsBaseDir, "safe-skill", files);

    const skillDir = path.join(skillsBaseDir, "safe-skill");
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, "__proto__"))).toBe(false);
    expect(fs.existsSync(path.join(skillDir, "constructor"))).toBe(false);
    expect(fs.existsSync(path.join(skillDir, "prototype"))).toBe(false);
    expect((Object.prototype as any).evilProtoContent).toBeUndefined();
  });

  it("overwrites existing files cleanly when installing skill updates", () => {
    installSkillFiles(skillsBaseDir, "updatable-skill", {
      "SKILL.md": "# Version 1.0"
    });

    const file = path.join(skillsBaseDir, "updatable-skill", "SKILL.md");
    expect(fs.readFileSync(file, "utf8")).toBe("# Version 1.0");

    installSkillFiles(skillsBaseDir, "updatable-skill", {
      "SKILL.md": "# Version 2.0"
    });

    expect(fs.readFileSync(file, "utf8")).toBe("# Version 2.0");
  });

  it("detects and rejects symlinks pointing outside skillsBaseDir", () => {
    const outsideDir = path.join(testDir, "outside-skills");
    fs.mkdirSync(outsideDir, { recursive: true });

    // Case 1: skill directory itself is a symlink pointing outside
    const escapedSkillPath = path.join(skillsBaseDir, "escaped-skill");
    fs.symlinkSync(outsideDir, escapedSkillPath);

    expect(() => {
      installSkillFiles(skillsBaseDir, "escaped-skill", {
        "SKILL.md": "# Escaped Skill"
      });
    }).toThrow(/traversal/i);

    expect(fs.existsSync(path.join(outsideDir, "SKILL.md"))).toBe(false);

    // Case 2: subpath/parent directory inside skill is a symlink pointing outside
    const validSkillDir = path.join(skillsBaseDir, "valid-skill");
    fs.mkdirSync(validSkillDir, { recursive: true });
    const symlinkSubdir = path.join(validSkillDir, "linked-sub");
    fs.symlinkSync(outsideDir, symlinkSubdir);

    expect(() => {
      installSkillFiles(skillsBaseDir, "valid-skill", {
        "linked-sub/secret.txt": "leak"
      });
    }).toThrow(/traversal/i);

    expect(fs.existsSync(path.join(outsideDir, "secret.txt"))).toBe(false);

    // Case 3: specific target file is a symlink pointing outside
    const outsideFile = path.join(outsideDir, "target-file.txt");
    fs.writeFileSync(outsideFile, "original", "utf8");
    const symlinkFile = path.join(validSkillDir, "linked-file.txt");
    fs.symlinkSync(outsideFile, symlinkFile);

    expect(() => {
      installSkillFiles(skillsBaseDir, "valid-skill", {
        "linked-file.txt": "overwritten"
      });
    }).toThrow(/traversal/i);

    expect(fs.readFileSync(outsideFile, "utf8")).toBe("original");
  });

  it("guards against files being an array", () => {
    installSkillFiles(skillsBaseDir, "array-skill", ["invalid-file"] as unknown as Record<string, string>);

    const skillDir = path.join(skillsBaseDir, "array-skill");
    expect(fs.existsSync(skillDir)).toBe(true);
    const files = fs.readdirSync(skillDir);
    expect(files.length).toBe(0);
  });
});

describe("Plugins Merger & File Installer", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-plugins-merger-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("merges array plugins into JSONC file without duplicates", () => {
    const configPath = path.join(testDir, "test-opencode.jsonc");
    fs.writeFileSync(configPath, `{\n  // comment\n  "plugin": ["existing-plugin"]\n}`, "utf8");

    mergePluginsIntoFile(configPath, ["new-plugin@latest", "existing-plugin"], "plugin", "array");

    const content = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(stripJsonComments(content));
    expect(parsed.plugin).toEqual(["existing-plugin", "new-plugin@latest"]);
  });

  it("merges map plugins into JSON file setting true", () => {
    const configPath = path.join(testDir, "test-claude.json");
    fs.writeFileSync(configPath, JSON.stringify({ enabledPlugins: { "old-plugin": true } }), "utf8");

    mergePluginsIntoFile(configPath, ["new-plugin@marketplace"], "enabledPlugins", "map");

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.enabledPlugins["old-plugin"]).toBe(true);
    expect(parsed.enabledPlugins["new-plugin@marketplace"]).toBe(true);
  });

  it("installPluginFiles writes plugin scripts and rejects path traversal", () => {
    const pluginDir = path.join(testDir, "plugins");
    installPluginFiles(pluginDir, "my-plugin", {
      "index.ts": "console.log('hi');"
    });

    expect(fs.existsSync(path.join(pluginDir, "index.ts")) || fs.existsSync(path.join(pluginDir, "my-plugin", "index.ts"))).toBe(true);

    expect(() => {
      installPluginFiles(pluginDir, "evil-plugin", {
        "../../bad.txt": "evil"
      });
    }).toThrow(/traversal/i);
  });

  it("mergePluginsIntoFile validates arguments and rejects prototype pollution keys", () => {
    expect(() => mergePluginsIntoFile("", ["plugin1"])).toThrow(/Invalid filePath/);
    expect(() => mergePluginsIntoFile(null as any, ["plugin1"])).toThrow(/Invalid filePath/);
    expect(() => mergePluginsIntoFile(path.join(testDir, "conf.json"), ["plugin1"], "__proto__")).toThrow(/Invalid key/);
    expect(() => mergePluginsIntoFile(path.join(testDir, "conf.json"), ["plugin1"], "constructor")).toThrow(/Invalid key/);
    expect(() => mergePluginsIntoFile(path.join(testDir, "conf.json"), ["plugin1"], "prototype")).toThrow(/Invalid key/);
  });

  it("mergePluginsIntoFile supports PluginEntry objects and ignores empty strings", () => {
    const configPath = path.join(testDir, "opencode-objects.json");
    fs.writeFileSync(configPath, JSON.stringify({ plugin: ["init-plugin"] }), "utf8");

    mergePluginsIntoFile(
      configPath,
      [
        { name: "obj-plugin-1", targetAgent: "opencode" },
        "   ",
        "",
        { name: "obj-plugin-2" },
        "str-plugin-3"
      ],
      "plugin",
      "array"
    );

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.plugin).toEqual(["init-plugin", "obj-plugin-1", "obj-plugin-2", "str-plugin-3"]);
  });

  it("mergePluginsIntoFile recognizes existing 'plugins' plural key in array format", () => {
    const configPath = path.join(testDir, "opencode-plural.json");
    fs.writeFileSync(configPath, JSON.stringify({ plugins: ["existing-plural"] }), "utf8");

    mergePluginsIntoFile(configPath, ["new-plural"], "plugin", "array");

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.plugins).toEqual(["existing-plural", "new-plural"]);
    expect(parsed.plugin).toBeUndefined();
  });

  it("mergePluginsIntoFile prevents prototype pollution in map format", () => {
    const configPath = path.join(testDir, "claude-pollution.json");
    fs.writeFileSync(configPath, JSON.stringify({ enabledPlugins: {} }), "utf8");

    mergePluginsIntoFile(
      configPath,
      ["__proto__", "constructor", "prototype", "valid-plugin"],
      "enabledPlugins",
      "map"
    );

    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.enabledPlugins["valid-plugin"]).toBe(true);
    expect(Object.hasOwn(parsed.enabledPlugins, "__proto__")).toBe(false);
    expect(Object.hasOwn(parsed.enabledPlugins, "constructor")).toBe(false);
    expect(Object.hasOwn(parsed.enabledPlugins, "prototype")).toBe(false);
  });

  it("mergePluginsIntoFile creates file and parent dirs when file does not exist", () => {
    const configPath = path.join(testDir, "nested", "deep", "config.json");
    mergePluginsIntoFile(configPath, ["created-plugin"], "plugin", "array");

    expect(fs.existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.plugin).toEqual(["created-plugin"]);
  });

  it("mergePluginsIntoFile recovers gracefully from corrupt existing JSON", () => {
    const configPath = path.join(testDir, "corrupt.json");
    fs.writeFileSync(configPath, "{ not valid json @@@", "utf8");

    mergePluginsIntoFile(configPath, ["recovered-plugin"], "plugin", "array");

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.plugin).toEqual(["recovered-plugin"]);
  });

  it("installPluginFiles validates targetDir and handles empty/null files safely", () => {
    expect(() => installPluginFiles("", "test-plugin", {})).toThrow(/Invalid targetDir/);
    expect(() => installPluginFiles(null as any, "test-plugin", {})).toThrow(/Invalid targetDir/);

    const safeDir = path.join(testDir, "safe-plugins");
    expect(() => installPluginFiles(safeDir, "test-plugin", null as any)).not.toThrow();
    expect(() => installPluginFiles(safeDir, "test-plugin", [] as any)).not.toThrow();
  });

  it("installPluginFiles handles multi-file plugins into a dedicated subdirectory", () => {
    const pluginDir = path.join(testDir, "plugins-multi");
    installPluginFiles(pluginDir, "complex-plugin", {
      "index.ts": "export const a = 1;",
      "utils/helper.ts": "export const b = 2;"
    });

    expect(fs.existsSync(path.join(pluginDir, "complex-plugin", "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, "complex-plugin", "utils", "helper.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(pluginDir, "complex-plugin", "utils", "helper.ts"), "utf8")).toBe("export const b = 2;");
  });

  it("installPluginFiles rejects windows backslash traversal and absolute paths", () => {
    const pluginDir = path.join(testDir, "plugins-sec");

    expect(() => {
      installPluginFiles(pluginDir, "evil-plugin", {
        "..\\..\\bad.txt": "evil"
      });
    }).toThrow(/traversal/i);

    expect(() => {
      installPluginFiles(pluginDir, "evil-plugin", {
        "/etc/bad.txt": "evil"
      });
    }).toThrow(/traversal/i);

    expect(() => {
      installPluginFiles(pluginDir, "evil-plugin", {
        "\\windows\\bad.txt": "evil"
      });
    }).toThrow(/traversal/i);
  });
});
