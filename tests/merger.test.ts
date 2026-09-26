import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSkillFiles, mergeMcpServersIntoFile } from "../src/core/merger.ts";
import type { McpServerConfig } from "../src/types.ts";

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
    }).toThrow();

    expect(() => {
      mergeMcpServersIntoFile(configPath, { evil: { command: "bad" } }, "constructor");
    }).toThrow();

    expect(() => {
      mergeMcpServersIntoFile(configPath, { evil: { command: "bad" } }, "prototype");
    }).toThrow();

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
    }).toThrow();

    expect(() => {
      installSkillFiles(skillsBaseDir, ".", { "SKILL.md": "test" });
    }).toThrow();

    expect(() => {
      installSkillFiles(skillsBaseDir, "..", { "SKILL.md": "test" });
    }).toThrow();

    expect(() => {
      installSkillFiles(skillsBaseDir, "a/b", { "SKILL.md": "test" });
    }).toThrow();
  });

  it("rejects prototype pollution keys in skillName (__proto__, constructor, prototype)", () => {
    expect(() => {
      installSkillFiles(skillsBaseDir, "__proto__", { "SKILL.md": "evil" });
    }).toThrow();

    expect(() => {
      installSkillFiles(skillsBaseDir, "constructor", { "SKILL.md": "evil" });
    }).toThrow();

    expect(() => {
      installSkillFiles(skillsBaseDir, "prototype", { "SKILL.md": "evil" });
    }).toThrow();
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
});
