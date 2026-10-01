import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_AGENTS,
  checkPackUpdateStatus,
  getInstalledPacks,
  recordInstalledPack,
  removeInstalledPack,
  uninstallPackFromAgents,
  type AgentProfile,
  type InstalledPackRecord
} from "../packages/core/src/index.ts";

describe("Pack Lifecycle: State Tracking & Uninstall", () => {
  let testDir: string;
  let prevSmcpDir: string | undefined;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-lifecycle-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(testDir, { recursive: true });
    prevSmcpDir = process.env.SMCP_DIR;
    process.env.SMCP_DIR = path.join(testDir, ".smcp");
  });

  afterEach(() => {
    if (prevSmcpDir !== undefined) {
      process.env.SMCP_DIR = prevSmcpDir;
    } else {
      delete process.env.SMCP_DIR;
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("State tracking (recordInstalledPack / getInstalledPacks / removeInstalledPack)", () => {
    it("records and retrieves installed packs", () => {
      expect(getInstalledPacks()).toEqual({});

      const record: InstalledPackRecord = {
        name: "test-pack",
        source: "https://gist.github.com/test/12345",
        version: "1.0.0",
        targetAgents: ["opencode"],
        runtime: "npx",
        installedMcp: ["context7"],
        installedSkills: ["brainstorming"],
        installedPlugins: [],
        installedAt: new Date().toISOString()
      };

      recordInstalledPack(record);

      const installed = getInstalledPacks();
      expect(installed["test-pack"]).toBeDefined();
      expect(installed["test-pack"].version).toBe("1.0.0");
      expect(installed["test-pack"].source).toBe("https://gist.github.com/test/12345");
      expect(installed["test-pack"].installedMcp).toEqual(["context7"]);

      const removed = removeInstalledPack("test-pack");
      expect(removed).toBe(true);
      expect(getInstalledPacks()).toEqual({});
    });
  });

  describe("uninstallPackFromAgents", () => {
    it("removes MCP servers and skill folders from agent targets", () => {
      const opencodeConfig = path.join(testDir, "opencode.jsonc");
      const skillsDir = path.join(testDir, ".opencode", "skills");
      const skillFolder = path.join(skillsDir, "my-skill");
      fs.mkdirSync(skillFolder, { recursive: true });
      fs.writeFileSync(path.join(skillFolder, "SKILL.md"), "# Test Skill", "utf8");

      fs.writeFileSync(
        opencodeConfig,
        JSON.stringify({
          mcp: {
            servers: {
              serverA: { command: ["npx", "-y", "pkg-a"] },
              serverB: { command: ["npx", "-y", "pkg-b"] }
            }
          }
        }, null, 2),
        "utf8"
      );

      const customProfiles: Record<string, AgentProfile> = {
        opencode: {
          ...DEFAULT_AGENTS.opencode,
          mcpConfig: {
            paths: [opencodeConfig],
            key: "mcp",
            format: "opencode"
          },
          skills: {
            paths: [skillsDir]
          }
        }
      };

      const record: InstalledPackRecord = {
        name: "test-pack",
        source: "https://gist.github.com/test/12345",
        version: "1.0.0",
        targetAgents: ["opencode"],
        installedMcp: ["serverA"],
        installedSkills: ["my-skill"],
        installedPlugins: [],
        installedAt: new Date().toISOString()
      };

      uninstallPackFromAgents(record, customProfiles);

      // Verify serverA was removed, but serverB remains
      const updatedConfig = JSON.parse(fs.readFileSync(opencodeConfig, "utf8"));
      expect(updatedConfig.mcp.servers.serverA).toBeUndefined();
      expect(updatedConfig.mcp.servers.serverB).toBeDefined();

      // Verify skill directory was removed
      expect(fs.existsSync(skillFolder)).toBe(false);
      expect(fs.existsSync(skillsDir)).toBe(true);
    });
  });

  describe("checkPackUpdateStatus", () => {
    it("reports up-to-date when remote version matches installed version", async () => {
      const localPackDir = path.join(testDir, "pack-same");
      fs.mkdirSync(localPackDir, { recursive: true });
      fs.writeFileSync(
        path.join(localPackDir, "smcp.json"),
        JSON.stringify({ name: "pack-same", version: "1.0.0" }),
        "utf8"
      );

      const record: InstalledPackRecord = {
        name: "pack-same",
        source: localPackDir,
        version: "1.0.0",
        targetAgents: ["opencode"],
        installedMcp: [],
        installedSkills: [],
        installedPlugins: [],
        installedAt: new Date().toISOString()
      };

      const result = await checkPackUpdateStatus(record);
      expect(result.status).toBe("up-to-date");
      expect(result.installedVersion).toBe("1.0.0");
      expect(result.latestVersion).toBe("1.0.0");
    });

    it("reports outdated when remote version is newer", async () => {
      const localPackDir = path.join(testDir, "pack-newer");
      fs.mkdirSync(localPackDir, { recursive: true });
      fs.writeFileSync(
        path.join(localPackDir, "smcp.json"),
        JSON.stringify({ name: "pack-newer", version: "2.1.0" }),
        "utf8"
      );

      const record: InstalledPackRecord = {
        name: "pack-newer",
        source: localPackDir,
        version: "1.0.0",
        targetAgents: ["opencode"],
        installedMcp: [],
        installedSkills: [],
        installedPlugins: [],
        installedAt: new Date().toISOString()
      };

      const result = await checkPackUpdateStatus(record);
      expect(result.status).toBe("outdated");
      expect(result.installedVersion).toBe("1.0.0");
      expect(result.latestVersion).toBe("2.1.0");
    });

    it("reports deleted / unavailable gracefully when source does not exist or was deleted", async () => {
      const nonExistentPath = path.join(testDir, "deleted-pack-404");

      const record: InstalledPackRecord = {
        name: "deleted-pack",
        source: nonExistentPath,
        version: "1.0.0",
        targetAgents: ["opencode"],
        installedMcp: [],
        installedSkills: [],
        installedPlugins: [],
        installedAt: new Date().toISOString()
      };

      const result = await checkPackUpdateStatus(record);
      expect(result.status).toBe("deleted");
      expect(result.error).toBeDefined();
    });
  });

  describe("CLI Commands: install -> outdated -> update -> uninstall", () => {
    it("completes full pack lifecycle via CLI commands", () => {
      const { execSync } = require("node:child_process");
      const binSmcp = path.resolve(__dirname, "../packages/cli/bin/smcp.js");

      const packDir = path.join(testDir, "lifecycle-pack");
      fs.mkdirSync(path.join(packDir, "skills", "hello-skill"), { recursive: true });
      fs.writeFileSync(
        path.join(packDir, "skills", "hello-skill", "SKILL.md"),
        "# Hello Skill",
        "utf8"
      );

      const smcpJsonPath = path.join(packDir, "smcp.json");
      fs.writeFileSync(
        smcpJsonPath,
        JSON.stringify({
          name: "lifecycle-pack",
          version: "1.0.0",
          mcpServers: {
            testServer: {
              command: ["npx", "-y", "test-server-pkg"]
            }
          },
          skills: [{ name: "hello-skill", path: "skills/hello-skill" }]
        }, null, 2),
        "utf8"
      );

      const targetEnv = path.join(testDir, "agent-env");
      fs.mkdirSync(targetEnv, { recursive: true });
      const opencodeConfig = path.join(targetEnv, "opencode.jsonc");
      fs.writeFileSync(
        opencodeConfig,
        JSON.stringify({ mcp: { servers: {} } }),
        "utf8"
      );

      const envOptions = {
        cwd: targetEnv,
        encoding: "utf8" as const,
        env: {
          ...process.env,
          SMCP_DIR: path.join(testDir, ".smcp")
        }
      };

      // 1. Install pack
      const installOut = execSync(
        `node "${binSmcp}" install "${packDir}" -a opencode -f -y --json`,
        envOptions
      );
      const installRes = JSON.parse(installOut);
      expect(installRes.success).toBe(true);

      // Verify installed.json was populated
      const installedFile = path.join(testDir, ".smcp", "installed.json");
      expect(fs.existsSync(installedFile)).toBe(true);
      const installedData = JSON.parse(fs.readFileSync(installedFile, "utf8"));
      expect(installedData["lifecycle-pack"]).toBeDefined();
      expect(installedData["lifecycle-pack"].version).toBe("1.0.0");

      // 2. Check outdated (currently up-to-date)
      const outdatedOut1 = execSync(`node "${binSmcp}" outdated --json`, envOptions);
      const outdatedRes1 = JSON.parse(outdatedOut1);
      expect(outdatedRes1.success).toBe(true);
      const p1 = outdatedRes1.packs.find((p: any) => p.name === "lifecycle-pack");
      expect(p1.status).toBe("up-to-date");

      // Bump version in packDir
      fs.writeFileSync(
        smcpJsonPath,
        JSON.stringify({
          name: "lifecycle-pack",
          version: "1.1.0",
          mcpServers: {
            testServer: {
              command: ["npx", "-y", "test-server-pkg-v2"]
            }
          },
          skills: [{ name: "hello-skill", path: "skills/hello-skill" }]
        }, null, 2),
        "utf8"
      );

      // 3. Check outdated (now outdated)
      const outdatedOut2 = execSync(`node "${binSmcp}" outdated --json`, envOptions);
      const outdatedRes2 = JSON.parse(outdatedOut2);
      const p2 = outdatedRes2.packs.find((p: any) => p.name === "lifecycle-pack");
      expect(p2.status).toBe("outdated");
      expect(p2.latestVersion).toBe("1.1.0");

      // 4. Update pack
      const updateOut = execSync(`node "${binSmcp}" update lifecycle-pack -y --json`, envOptions);
      const updateRes = JSON.parse(updateOut);
      expect(updateRes.success).toBe(true);

      const installedDataAfterUpdate = JSON.parse(fs.readFileSync(installedFile, "utf8"));
      expect(installedDataAfterUpdate["lifecycle-pack"].version).toBe("1.1.0");

      // 5. Delete source and test update error handling
      fs.rmSync(packDir, { recursive: true, force: true });
      const updateDeletedOut = execSync(
        `node "${binSmcp}" update lifecycle-pack -y --json`,
        { ...envOptions, stdio: "pipe" }
      ).toString();
      const updateDeletedRes = JSON.parse(updateDeletedOut);
      expect(updateDeletedRes.success).toBe(false);
      expect(updateDeletedRes.error).toContain("deleted or returned 404");

      // 6. Uninstall pack
      const uninstallOut = execSync(`node "${binSmcp}" uninstall lifecycle-pack -y --json`, envOptions);
      const uninstallRes = JSON.parse(uninstallOut);
      expect(uninstallRes.success).toBe(true);

      const installedDataAfterUninstall = JSON.parse(fs.readFileSync(installedFile, "utf8"));
      expect(installedDataAfterUninstall["lifecycle-pack"]).toBeUndefined();
    });
  });
});
