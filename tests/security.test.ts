import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveCustomAgent } from "../packages/core/src/core/agents/index.ts";
import {
  installPluginFiles,
  installSkillFiles,
  mergeMcpServersIntoFile,
  mergePluginsIntoFile
} from "../packages/core/src/core/merger/index.ts";
import { extractPluginFiles, extractSkillFiles } from "../packages/cli/src/commands/install/index.ts";
import { atomicWriteFileSync } from "../packages/core/src/utils/fs.ts";
import { isPrototypePollutionKey } from "../packages/core/src/utils/security.ts";

describe("Security & Hardening Test Suite", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      "smcp-sec-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("isPrototypePollutionKey", () => {
    it("identifies __proto__, constructor, and prototype", () => {
      expect(isPrototypePollutionKey("__proto__")).toBe(true);
      expect(isPrototypePollutionKey("constructor")).toBe(true);
      expect(isPrototypePollutionKey("prototype")).toBe(true);
    });

    it("returns false for safe keys", () => {
      expect(isPrototypePollutionKey("name")).toBe(false);
      expect(isPrototypePollutionKey("skills")).toBe(false);
      expect(isPrototypePollutionKey("mcpServers")).toBe(false);
      expect(isPrototypePollutionKey("")).toBe(false);
    });

    it("returns false for non-string values", () => {
      expect(isPrototypePollutionKey(null)).toBe(false);
      expect(isPrototypePollutionKey(undefined)).toBe(false);
      expect(isPrototypePollutionKey(123 as any)).toBe(false);
      expect(isPrototypePollutionKey({} as any)).toBe(false);
    });
  });

  describe("Prototype Pollution Defenses", () => {
    it("saveCustomAgent rejects prototype pollution keys as agent IDs", () => {
      const customPath = path.join(tmpDir, "custom-agents.json");
      const dummyProfile = { name: "Evil Agent", mcpConfig: null, skills: null };

      expect(() => saveCustomAgent("__proto__", dummyProfile, customPath)).toThrow(/Invalid agent ID/);
      expect(() => saveCustomAgent("constructor", dummyProfile, customPath)).toThrow(/Invalid agent ID/);
      expect(() => saveCustomAgent("prototype", dummyProfile, customPath)).toThrow(/Invalid agent ID/);
    });

    it("mergeMcpServersIntoFile rejects prototype pollution in mcpKey and ignores in servers", () => {
      const confPath = path.join(tmpDir, "mcp.json");
      expect(() => mergeMcpServersIntoFile(confPath, {}, "__proto__")).toThrow(/Invalid mcpKey/);
      expect(() => mergeMcpServersIntoFile(confPath, {}, "constructor")).toThrow(/Invalid mcpKey/);
      expect(() => mergeMcpServersIntoFile(confPath, {}, "prototype")).toThrow(/Invalid mcpKey/);

      mergeMcpServersIntoFile(confPath, {
        __proto__: { command: "node", args: ["pollute.js"] } as any,
        constructor: { command: "node", args: ["pollute.js"] } as any,
        safeServer: { command: "node", args: ["safe.js"] }
      });

      const parsed = JSON.parse(fs.readFileSync(confPath, "utf8"));
      expect(parsed.mcpServers.safeServer).toBeDefined();
      expect(Object.hasOwn(parsed.mcpServers, "__proto__")).toBe(false);
      expect(Object.hasOwn(parsed.mcpServers, "constructor")).toBe(false);
      expect(Object.hasOwn(parsed.mcpServers, "prototype")).toBe(false);
    });

    it("mergePluginsIntoFile rejects prototype pollution in key and ignores in plugin names", () => {
      const confPath = path.join(tmpDir, "plugins.json");
      expect(() => mergePluginsIntoFile(confPath, ["test"], "__proto__")).toThrow(/Invalid key/);

      // Array format
      mergePluginsIntoFile(confPath, ["__proto__", "constructor", "prototype", "safe-plugin"], "plugin", "array");
      let parsed = JSON.parse(fs.readFileSync(confPath, "utf8"));
      expect(parsed.plugin).toEqual(["safe-plugin"]);

      // Map format
      const mapPath = path.join(tmpDir, "plugins-map.json");
      mergePluginsIntoFile(mapPath, ["__proto__", "constructor", "prototype", "safe-map-plugin"], "enabledPlugins", "map");
      parsed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
      expect(parsed.enabledPlugins["safe-map-plugin"]).toBe(true);
      expect(Object.hasOwn(parsed.enabledPlugins, "__proto__")).toBe(false);
      expect(Object.hasOwn(parsed.enabledPlugins, "constructor")).toBe(false);
    });

    it("installSkillFiles rejects prototype pollution keys as skillName", () => {
      const skillsDir = path.join(tmpDir, "skills");
      expect(() => installSkillFiles(skillsDir, "__proto__", { "SKILL.md": "# Evil" })).toThrow(/Directory traversal/);
      expect(() => installSkillFiles(skillsDir, "constructor", { "SKILL.md": "# Evil" })).toThrow(/Directory traversal/);
      expect(() => installSkillFiles(skillsDir, "prototype", { "SKILL.md": "# Evil" })).toThrow(/Directory traversal/);
    });
  });

  describe("Directory Traversal & Symlink Escape Defenses", () => {
    it("installSkillFiles rejects traversal in skillName and filenames", () => {
      const skillsDir = path.join(tmpDir, "skills");

      expect(() => installSkillFiles(skillsDir, "../escape", { "SKILL.md": "evil" })).toThrow(/Directory traversal/);
      expect(() => installSkillFiles(skillsDir, "../../etc", { "SKILL.md": "evil" })).toThrow(/Directory traversal/);
      expect(() => installSkillFiles(skillsDir, "/root", { "SKILL.md": "evil" })).toThrow(/Directory traversal/);
      expect(() => installSkillFiles(skillsDir, "safe-skill", { "../escape.txt": "evil" })).toThrow(/Directory traversal/);
      expect(() => installSkillFiles(skillsDir, "safe-skill", { "sub/../../escape.txt": "evil" })).toThrow(/Directory traversal/);
      expect(() => installSkillFiles(skillsDir, "safe-skill", { "/etc/passwd": "evil" })).toThrow(/Directory traversal/);
    });

    it("installSkillFiles detects and blocks symlink traversal outside skills base directory", () => {
      const skillsDir = path.join(tmpDir, "sym-skills");
      const outsideDir = path.join(tmpDir, "outside-target");
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });

      // Create a symlink inside skillsDir pointing to outsideDir
      const symlinkPath = path.join(skillsDir, "evil-symlink");
      fs.symlinkSync(outsideDir, symlinkPath, "dir");

      expect(() => {
        installSkillFiles(skillsDir, "evil-symlink", { "payload.txt": "pwn" });
      }).toThrow(/Directory traversal/);

      expect(fs.existsSync(path.join(outsideDir, "payload.txt"))).toBe(false);
    });

    it("installPluginFiles rejects traversal in relative file paths", () => {
      const pluginDir = path.join(tmpDir, "plugins");

      expect(() => {
        installPluginFiles(pluginDir, "test-plugin", {
          "../../outside.ts": "evil"
        });
      }).toThrow(/Directory traversal/);

      expect(() => {
        installPluginFiles(pluginDir, "test-plugin", {
          "/absolute/outside.ts": "evil"
        });
      }).toThrow(/Directory traversal/);

      expect(() => {
        installPluginFiles(pluginDir, "test-plugin", {
          "..\\..\\win-outside.ts": "evil"
        });
      }).toThrow(/Directory traversal/);

      expect(() => {
        installPluginFiles(pluginDir, "test-plugin", {
          "sub/../../escape.ts": "evil"
        });
      }).toThrow(/Directory traversal/);
    });

    it("extractSkillFiles and extractPluginFiles strip out directory traversal attempts", () => {
      const skillFiles = extractSkillFiles(
        { name: "test-skill", path: "skills/test/SKILL.md" },
        {
          "skills_test-skill_../../secret.txt": "evil 1",
          "skills_test-skill_/etc/passwd": "evil 2",
          "skills_test-skill_valid.txt": "safe"
        }
      );
      expect(skillFiles["valid.txt"]).toBe("safe");
      expect(skillFiles["../../secret.txt"]).toBeUndefined();
      expect(skillFiles["/etc/passwd"]).toBeUndefined();

      const pluginFiles = extractPluginFiles(
        { name: "test-plugin" },
        {
          "plugins_test-plugin_../../escape.ts": "evil 3",
          "plugins_test-plugin_/abs.ts": "evil 4",
          "plugins_test-plugin_safe.ts": "safe code"
        }
      );
      expect(pluginFiles["safe.ts"]).toBe("safe code");
      expect(pluginFiles["../../escape.ts"]).toBeUndefined();
      expect(pluginFiles["/abs.ts"]).toBeUndefined();
    });

    it("extractSkillFiles and extractPluginFiles block localDir path traversal attacks via skill or plugin name", () => {
      const localPackDir = path.join(tmpDir, "local-pack");
      const sensitiveDir = path.join(tmpDir, "victim-secrets");
      fs.mkdirSync(localPackDir, { recursive: true });
      fs.mkdirSync(sensitiveDir, { recursive: true });
      fs.writeFileSync(path.join(sensitiveDir, "id_rsa"), "SECRET KEY CONTENT", "utf8");

      // Attempt traversal out of localPackDir into victim-secrets
      const evilSkill = { name: "../victim-secrets", path: "skills/evil" };
      const extractedSkill = extractSkillFiles(evilSkill, undefined, localPackDir);
      expect(extractedSkill["id_rsa"]).toBeUndefined();

      const evilPlugin = { name: "../victim-secrets" };
      const extractedPlugin = extractPluginFiles(evilPlugin, undefined, localPackDir);
      expect(extractedPlugin["id_rsa"]).toBeUndefined();
    });

    it("installPluginFiles rejects directory traversal in pluginName", () => {
      const pluginDir = path.join(tmpDir, "plugins-name-test");
      expect(() => installPluginFiles(pluginDir, "../evil-name", { "tool.ts": "code" })).toThrow(/Directory traversal/);
      expect(() => installPluginFiles(pluginDir, "/absolute/name", { "tool.ts": "code" })).toThrow(/Directory traversal/);
      expect(() => installPluginFiles(pluginDir, "__proto__", { "tool.ts": "code" })).toThrow(/Directory traversal/);
    });

    it("installPluginFiles detects and blocks symlink traversal outside plugin base directory", () => {
      const pluginDir = path.join(tmpDir, "sym-plugins");
      const outsideDir = path.join(tmpDir, "outside-plugin-target");
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });

      const symlinkPath = path.join(pluginDir, "evil-symlink");
      fs.symlinkSync(outsideDir, symlinkPath, "dir");

      expect(() => {
        installPluginFiles(pluginDir, "evil-symlink", { "tool.ts": "payload" });
      }).toThrow(/Directory traversal|symlink escape/);

      expect(fs.existsSync(path.join(outsideDir, "tool.ts"))).toBe(false);
    });
  });

  describe("Atomic File Operations & Permissions", () => {
    it("atomicWriteFileSync writes safely and sets specific file mode", () => {
      const filePath = path.join(tmpDir, "secure", "secret.json");
      atomicWriteFileSync(filePath, JSON.stringify({ token: "xyz" }), { mode: 0o600 });

      expect(fs.existsSync(filePath)).toBe(true);
      const stat = fs.statSync(filePath);
      // Mode owner read/write (0o600)
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });
});
