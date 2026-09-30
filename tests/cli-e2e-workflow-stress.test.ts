import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectCommand } from "../packages/cli/src/commands/inspect.ts";
import {
  extractPluginFiles,
  extractSkillFiles,
  installPackIntoAgents,
  resolveMcpServerTemplates
} from "../packages/cli/src/commands/install/index.ts";
import { bundlePluginFiles, bundleSkillFiles, exportPackLocally } from "../packages/cli/src/commands/share/index.ts";
import {
  DEFAULT_AGENTS,
  detectAgents,
  filterAgents,
  readInstalledMcpServers,
  readInstalledPlugins,
  scanSkills
} from "../packages/core/src/core/agents/index.ts";
import { redactMcpServers } from "../packages/core/src/core/redactor/index.ts";
import type { AgentProfile, DetectedAgent, Manifest, McpServerConfig, PluginEntry, SkillEntry } from "../packages/core/src/types/index.ts";

describe("CLI End-to-End Pack Export, Bundle, Inspect & Install Workflow Stress", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      "smcp-cli-e2e-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("executes full lifecycle: export pack locally, bundle skills/plugins, and install into target agent", async () => {
    // 1. Setup Source Agent Environment
    const sourceDir = path.join(tmpDir, "source-agent");
    const sourceSkillsDir = path.join(sourceDir, "skills");
    const sourceSkillDir = path.join(sourceSkillsDir, "weather-skill");
    fs.mkdirSync(sourceSkillDir, { recursive: true });
    fs.writeFileSync(path.join(sourceSkillDir, "SKILL.md"), "# Weather Skill\nProvides weather info", "utf8");
    fs.writeFileSync(path.join(sourceSkillDir, "helper.sh"), "echo sunny", "utf8");

    const sourcePluginsDir = path.join(sourceDir, "plugins");
    const sourcePluginDir = path.join(sourcePluginsDir, "cache-plugin");
    fs.mkdirSync(sourcePluginDir, { recursive: true });
    fs.writeFileSync(path.join(sourcePluginDir, "index.ts"), "export const cache = new Map();", "utf8");

    // 2. Scan source skills and bundle them
    const scannedSkills = scanSkills(sourceSkillsDir);
    expect(scannedSkills.length).toBe(1);
    expect(scannedSkills[0].name).toBe("weather-skill");

    const { bundledSkills, gistFiles: skillGistFiles } = bundleSkillFiles(scannedSkills);
    expect(bundledSkills.length).toBe(1);
    expect(bundledSkills[0].files).toBeDefined();
    expect(bundledSkills[0].files!["SKILL.md"]).toContain("Weather Skill");
    expect(bundledSkills[0].files!["helper.sh"]).toBe("echo sunny");

    // 3. Bundle plugins
    const pluginsToBundle: PluginEntry[] = [
      {
        name: "cache-plugin",
        path: sourcePluginDir,
        description: "In-memory caching plugin"
      }
    ];
    const { bundledPlugins, gistFiles: pluginGistFiles } = await bundlePluginFiles(pluginsToBundle);
    expect(bundledPlugins.length).toBe(1);
    expect(bundledPlugins[0].files).toBeDefined();
    expect(bundledPlugins[0].files!["index.ts"]).toContain("export const cache");

    // 4. Redact sensitive MCP server configs
    const rawMcpServers: Record<string, McpServerConfig> = {
      weatherService: {
        command: "node",
        args: ["weather.js", "--api-key", "sk-ant-api03-weathersecret1234567890"],
        env: {
          DATABASE_URL: "postgresql://weatheruser:secretPass@localhost:5432/weatherdb",
          CITY_NAME: "Tokyo"
        }
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(rawMcpServers);
    expect(redactedServers.weatherService.args?.[2]).toBe("${WEATHERSERVICE_API_KEY}");
    expect(redactedServers.weatherService.env?.DATABASE_URL).toBe("${DATABASE_URL}");
    expect(redactedServers.weatherService.env?.CITY_NAME).toBe("Tokyo");
    expect(requiredEnv.some((e) => e.key === "WEATHERSERVICE_API_KEY" && e.isSecret)).toBe(true);
    expect(requiredEnv.some((e) => e.key === "DATABASE_URL" && e.isSecret)).toBe(true);

    // 5. Export pack locally to target output folder
    const exportOutputDir = path.join(tmpDir, "exported-pack");
    const manifest: Manifest = {
      name: "weather-suite-pack",
      version: "1.0.0",
      description: "Complete weather pack with secrets, skills, and plugins",
      mcpServers: redactedServers,
      skills: bundledSkills,
      plugins: bundledPlugins,
      requiredEnv
    };

    await exportPackLocally(manifest, bundledSkills, exportOutputDir, bundledPlugins);

    expect(fs.existsSync(path.join(exportOutputDir, "smcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(exportOutputDir, "skills", "weather-skill", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(exportOutputDir, "skills", "weather-skill", "helper.sh"))).toBe(true);
    expect(fs.existsSync(path.join(exportOutputDir, "plugins", "cache-plugin", "index.ts"))).toBe(true);

    // 6. Inspect the exported pack
    await inspectCommand(exportOutputDir, { json: false });

    // 7. Setup Target Agent Environment for installation
    const targetAgentDir = path.join(tmpDir, "target-claude-agent");
    const targetConfigFile = path.join(targetAgentDir, ".claude.json");
    const targetSkillsDir = path.join(targetAgentDir, ".claude", "skills");
    const targetPluginsDir = path.join(targetAgentDir, ".claude", "plugins");
    const targetPluginsConfig = path.join(targetAgentDir, ".claude", "plugins.json");

    fs.mkdirSync(path.dirname(targetConfigFile), { recursive: true });
    fs.mkdirSync(targetSkillsDir, { recursive: true });
    fs.mkdirSync(targetPluginsDir, { recursive: true });
    fs.writeFileSync(targetConfigFile, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");
    fs.writeFileSync(targetPluginsConfig, JSON.stringify({ enabledPlugins: {} }, null, 2), "utf8");

    const customProfiles: Record<string, AgentProfile> = {
      "claude-code": {
        name: "Claude Code",
        mcpConfig: {
          paths: [targetConfigFile],
          key: "mcpServers"
        },
        skills: {
          paths: [targetSkillsDir]
        },
        plugins: {
          paths: [targetPluginsConfig],
          key: "enabledPlugins",
          dirPaths: [targetPluginsDir],
          format: "map"
        }
      }
    };

    // 8. Resolve template placeholders
    const resolvedServers = resolveMcpServerTemplates(manifest.mcpServers!, {
      WEATHERSERVICE_API_KEY: "resolved-token-xyz",
      DATABASE_URL: "postgresql://live:pass@db.prod:5432/db"
    });

    expect(resolvedServers.weatherService.args?.[2]).toBe("resolved-token-xyz");
    expect(resolvedServers.weatherService.env?.DATABASE_URL).toBe("postgresql://live:pass@db.prod:5432/db");

    // 9. Install into target agent
    const installResult = await installPackIntoAgents(
      manifest,
      ["claude-code"],
      resolvedServers,
      undefined, // rawFiles
      exportOutputDir, // localDir
      customProfiles, // profiles
      targetPluginsDir // customPluginDir
    );

    expect(installResult.installedMcp).toContain("claude-code");
    expect(installResult.installedSkills).toContain("claude-code");
    expect(installResult.installedPlugins).toContain("claude-code");

    // 10. Verify Target Agent has all installed components
    const targetServers = readInstalledMcpServers(targetConfigFile);
    expect(targetServers.weatherService).toBeDefined();
    expect(targetServers.weatherService.args?.[2]).toBe("resolved-token-xyz");
    expect(targetServers.weatherService.env?.DATABASE_URL).toBe("postgresql://live:pass@db.prod:5432/db");

    const targetSkills = scanSkills(targetSkillsDir);
    expect(targetSkills.some((s) => s.name === "weather-skill")).toBe(true);
    expect(fs.existsSync(path.join(targetSkillsDir, "weather-skill", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetSkillsDir, "weather-skill", "helper.sh"))).toBe(true);

    expect(fs.existsSync(path.join(targetPluginsDir, "cache-plugin", "index.ts"))).toBe(true);
  });
});
