import { describe, expect, it, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  uninstallPackFromAgents,
  type AgentProfile,
  type InstalledPackRecord,
  type Manifest
} from "../packages/core/src/index.ts";

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-e2e-agents-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tmpDirs.length = 0;
});

describe("Install, State Tracking & Uninstall of Agents", () => {
  it("installs agent into opencode and claude-code, tracks in installed.json, and uninstalls cleanly", () => {
    const tmp = makeTmpDir();
    const homeDir = path.join(tmp, "home");
    const packDir = path.join(tmp, "pack");
    fs.mkdirSync(path.join(packDir, "agents"), { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });

    fs.writeFileSync(
      path.join(packDir, "smcp.json"),
      JSON.stringify({
        name: "agent-pack",
        version: "1.0.0",
        agents: [{ name: "tester", path: "./agents/tester.md", description: "Test specialist" }]
      })
    );
    fs.writeFileSync(
      path.join(packDir, "agents", "tester.md"),
      `---\nname: tester\ndescription: Test specialist\nmode: subagent\n---\nRun tests.`
    );

    const binSmcp = path.resolve("./packages/cli/dist/cli.js");

    // 1. Install into opencode and claude
    const installOut = execSync(
      `node "${binSmcp}" install "${packDir}" -a opencode,claude -f -y --global --json`,
      {
        cwd: tmp,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          SMCP_DIR: path.join(homeDir, ".smcp")
        }
      }
    );
    const parsedInstall = JSON.parse(installOut);
    expect(parsedInstall.success).toBe(true);
    expect(parsedInstall.installedAgents).toContain("tester");

    const opencodeAgentPath = path.join(homeDir, ".config", "opencode", "agents", "tester.md");
    const claudeAgentPath = path.join(homeDir, ".claude", "commands", "tester.md");
    expect(fs.existsSync(opencodeAgentPath)).toBe(true);
    expect(fs.existsSync(claudeAgentPath)).toBe(true);

    // 2. Verify state in ~/.smcp/installed.json
    const installedJsonPath = path.join(homeDir, ".smcp", "installed.json");
    expect(fs.existsSync(installedJsonPath)).toBe(true);
    const installedRecords = JSON.parse(fs.readFileSync(installedJsonPath, "utf8"));
    expect(installedRecords["agent-pack"].installedAgents).toContain("tester");

    // 3. Uninstall
    const uninstallOut = execSync(
      `node "${binSmcp}" uninstall agent-pack -y --json`,
      {
        cwd: tmp,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          SMCP_DIR: path.join(homeDir, ".smcp")
        }
      }
    );
    const parsedUninstall = JSON.parse(uninstallOut);
    expect(parsedUninstall.success).toBe(true);
    expect(fs.existsSync(opencodeAgentPath)).toBe(false);
    expect(fs.existsSync(claudeAgentPath)).toBe(false);
  });

  it("installs agent locally with project scope and uninstalls cleanly", () => {
    const tmp = makeTmpDir();
    const homeDir = path.join(tmp, "home");
    const packDir = path.join(tmp, "pack");
    const projectDir = path.join(tmp, "my-project");
    fs.mkdirSync(path.join(packDir, "agents"), { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    fs.writeFileSync(
      path.join(packDir, "smcp.json"),
      JSON.stringify({
        name: "local-agent-pack",
        version: "1.0.0",
        agents: [{ name: "local-helper", path: "./agents/local-helper.md", description: "Local helper" }]
      })
    );
    fs.writeFileSync(
      path.join(packDir, "agents", "local-helper.md"),
      `---\nname: local-helper\ndescription: Local helper\nmode: subagent\n---\nHelp locally.`
    );

    const binSmcp = path.resolve("./packages/cli/dist/cli.js");

    const installOut = execSync(
      `node "${binSmcp}" install "${packDir}" -a opencode -f -y --project --json`,
      {
        cwd: projectDir,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          SMCP_DIR: path.join(homeDir, ".smcp")
        }
      }
    );
    const parsedInstall = JSON.parse(installOut);
    expect(parsedInstall.success).toBe(true);
    expect(parsedInstall.installedAgents).toContain("local-helper");

    const localAgentFile = path.join(projectDir, ".opencode", "agents", "local-helper.md");
    expect(fs.existsSync(localAgentFile)).toBe(true);

    const uninstallOut = execSync(
      `node "${binSmcp}" uninstall local-agent-pack -y --json`,
      {
        cwd: projectDir,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          SMCP_DIR: path.join(homeDir, ".smcp")
        }
      }
    );
    const parsedUninstall = JSON.parse(uninstallOut);
    expect(parsedUninstall.success).toBe(true);
    expect(fs.existsSync(localAgentFile)).toBe(false);
  });

  it("updates agent file when re-installing an updated pack", () => {
    const tmp = makeTmpDir();
    const homeDir = path.join(tmp, "home");
    const packDir = path.join(tmp, "pack");
    fs.mkdirSync(path.join(packDir, "agents"), { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });

    fs.writeFileSync(
      path.join(packDir, "smcp.json"),
      JSON.stringify({
        name: "updatable-pack",
        version: "1.0.0",
        agents: [{ name: "worker", path: "./agents/worker.md", description: "Worker v1" }]
      })
    );
    fs.writeFileSync(
      path.join(packDir, "agents", "worker.md"),
      `---\nname: worker\ndescription: Worker v1\n---\nVersion 1 instructions.`
    );

    const binSmcp = path.resolve("./packages/cli/dist/cli.js");
    const env = {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      SMCP_DIR: path.join(homeDir, ".smcp")
    };

    // 1. Initial install
    execSync(`node "${binSmcp}" install "${packDir}" -a opencode -f -y --global --json`, {
      cwd: tmp,
      encoding: "utf8",
      env
    });

    const agentFilePath = path.join(homeDir, ".config", "opencode", "agents", "worker.md");
    expect(fs.existsSync(agentFilePath)).toBe(true);
    expect(fs.readFileSync(agentFilePath, "utf8")).toContain("Version 1 instructions.");

    // 2. Update pack
    fs.writeFileSync(
      path.join(packDir, "smcp.json"),
      JSON.stringify({
        name: "updatable-pack",
        version: "2.0.0",
        agents: [{ name: "worker", path: "./agents/worker.md", description: "Worker v2" }]
      })
    );
    fs.writeFileSync(
      path.join(packDir, "agents", "worker.md"),
      `---\nname: worker\ndescription: Worker v2\n---\nVersion 2 updated instructions.`
    );

    execSync(`node "${binSmcp}" install "${packDir}" -a opencode -f -y --global --json`, {
      cwd: tmp,
      encoding: "utf8",
      env
    });

    expect(fs.readFileSync(agentFilePath, "utf8")).toContain("Version 2 updated instructions.");
  });

  it("directly uninstalls agents via core uninstallPackFromAgents", () => {
    const tmp = makeTmpDir();
    const agentsDir = path.join(tmp, "custom-agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const agentFile = path.join(agentsDir, "cleanme.md");
    fs.writeFileSync(agentFile, "---\nname: cleanme\n---\nPrompt", "utf8");

    const customProfiles: Record<string, AgentProfile> = {
      opencode: {
        name: "OpenCode",
        mcpConfig: null,
        skills: null,
        plugins: null,
        agents: {
          paths: [agentsDir],
          format: "markdown"
        }
      }
    };

    const record: InstalledPackRecord = {
      name: "custom-pack",
      source: "local",
      version: "1.0.0",
      targetAgents: ["opencode"],
      installedMcp: [],
      installedSkills: [],
      installedPlugins: [],
      installedAgents: ["cleanme"],
      installedAt: new Date().toISOString()
    };

    expect(fs.existsSync(agentFile)).toBe(true);
    const result = uninstallPackFromAgents(record, customProfiles);
    expect(result.removedAgents).toContain("cleanme");
    expect(fs.existsSync(agentFile)).toBe(false);
  });

  it("extracts agent content from rawFiles when path has ./ prefix but rawFiles key does not", () => {
    const { extractAgentContent } = require("../packages/cli/src/commands/install/extract.ts");
    const rawFiles: Record<string, string> = {
      "agents/specialist.md": "---\nname: specialist\ndescription: Special\n---\nPrompt"
    };
    const content = extractAgentContent(
      { name: "specialist", path: "./agents/specialist.md" },
      rawFiles
    );
    expect(content).toContain("Prompt");
  });
});
