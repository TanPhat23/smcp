import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPackIntoAgents } from "../packages/cli/src/commands/install/index.ts";
import {
  DEFAULT_AGENTS,
  compileAgentForHarness,
  detectAgents,
  filterAgents,
  readInstalledHooks,
  readInstalledMcpServers,
  readInstalledPlugins,
  scanAgents,
  scanRules,
  scanSkills
} from "../packages/core/src/core/agents/index.ts";
import {
  StandardMcpAdapter,
  mergeHooksIntoFile,
  mergeMcpServersIntoFile,
  uninstallPackFromAgents
} from "../packages/core/src/core/merger/index.ts";
import { packDirectory } from "../packages/cli/src/commands/pack/pack.ts";
import type { AgentProfile, Manifest } from "../packages/core/src/types/index.ts";

function sandboxAgyProfile(baseDir: string, scope: "global" | "project"): Record<string, AgentProfile> {
  if (scope === "global") {
    return {
      agy: {
        name: "Antigravity",
        mcpConfig: { paths: [path.join(baseDir, ".gemini", "config", "mcp_config.json")], key: "mcpServers" },
        skills: { paths: [path.join(baseDir, ".gemini", "config", "skills")] },
        plugins: {
          paths: [path.join(baseDir, ".gemini", "config", "config.json")],
          key: "plugins",
          format: "directory",
          dirPaths: [path.join(baseDir, ".gemini", "config", "plugins")]
        },
        agents: {
          paths: [path.join(baseDir, ".gemini", "config", "agents")],
          format: "markdown"
        }
      }
    };
  }
  return {
    agy: {
      name: "Antigravity",
      mcpConfig: { paths: ["./.agents/mcp_config.json"], key: "mcpServers" },
      skills: { paths: ["./.agents/skills", "./.agent/skills"] },
      plugins: {
        paths: [],
        key: "plugins",
        format: "directory",
        dirPaths: ["./.agents/plugins"]
      },
      agents: {
        paths: ["./.agents/agents"],
        format: "markdown"
      }
    }
  };
}

describe("Antigravity (agy) on-disk layout & lifecycle", () => {
  let tmp: string;
  let proj: string;
  let home: string;
  let origCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-agy-layout-"));
    proj = path.join(tmp, "proj");
    home = path.join(tmp, "home");
    fs.mkdirSync(proj, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    origCwd = process.cwd();
    process.chdir(proj);
    proj = process.cwd();
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const manifest = (extra: Partial<Manifest> = {}): Manifest =>
    ({
      name: "agy-pack",
      version: "1.0.0",
      mcpServers: {},
      skills: [],
      plugins: [],
      requiredEnv: [],
      ...extra
    }) as Manifest;

  it("matches agy and antigravity terms in filterAgents", () => {
    const agents = [
      { id: "opencode", name: "OpenCode", mcpConfigPath: null, skillsDirPath: null },
      { id: "agy", name: "Antigravity", mcpConfigPath: null, skillsDirPath: null }
    ];
    expect(filterAgents(agents, ["agy"]).map((a) => a.id)).toEqual(["agy"]);
    expect(filterAgents(agents, ["antigravity"]).map((a) => a.id)).toEqual(["agy"]);
    expect(filterAgents(agents, ["antigravity-cli"]).map((a) => a.id)).toEqual(["agy"]);
  });

  it("normalizes Antigravity serverUrl to canonical url in readInstalledMcpServers and StandardMcpAdapter", () => {
    const mcpFile = path.join(home, "mcp_config.json");
    fs.writeFileSync(
      mcpFile,
      JSON.stringify({
        mcpServers: {
          remoteAgy: {
            serverUrl: "https://api.example.com/mcp",
            headers: { Authorization: "Bearer tok" }
          },
          localAgy: {
            command: "npx",
            args: ["-y", "tool"]
          }
        }
      }),
      "utf8"
    );

    const servers = readInstalledMcpServers(mcpFile);
    expect(servers.remoteAgy).toBeDefined();
    expect(servers.remoteAgy.url).toBe("https://api.example.com/mcp");
    expect((servers.remoteAgy as Record<string, unknown>).serverUrl).toBeUndefined();

    const adapter = new StandardMcpAdapter();
    const deserialized = adapter.deserialize({ serverUrl: "https://x.dev/mcp" });
    expect(deserialized.url).toBe("https://x.dev/mcp");
    const serialized = adapter.serialize(
      { serverUrl: "https://x.dev/mcp" } as NonNullable<Manifest["mcpServers"]>[string],
      { agentId: "agy" }
    );
    expect(serialized.url).toBe("https://x.dev/mcp");
    expect(serialized.serverUrl).toBeUndefined();
  });

  it("reads directory plugins for agy, respecting config.json and plugin.json disabled flags", () => {
    const configPath = path.join(home, "config.json");
    const pluginsDir = path.join(home, "plugins");
    fs.mkdirSync(path.join(pluginsDir, "enabled-plugin"), { recursive: true });
    fs.mkdirSync(path.join(pluginsDir, "disabled-by-config"), { recursive: true });
    fs.mkdirSync(path.join(pluginsDir, "disabled-by-manifest"), { recursive: true });
    fs.mkdirSync(path.join(pluginsDir, "nested-manifest"), { recursive: true });
    fs.mkdirSync(path.join(pluginsDir, "nested-manifest", ".antigravity-plugin"), { recursive: true });
    fs.mkdirSync(path.join(pluginsDir, "not-a-plugin"), { recursive: true });
    fs.mkdirSync(path.join(pluginsDir, ".hidden-dir"), { recursive: true });

    fs.writeFileSync(
      path.join(pluginsDir, "enabled-plugin", "plugin.json"),
      JSON.stringify({ name: "enabled-plugin", description: "Active plugin" })
    );
    fs.writeFileSync(
      path.join(pluginsDir, "disabled-by-config", "plugin.json"),
      JSON.stringify({ name: "disabled-by-config" })
    );
    fs.writeFileSync(
      path.join(pluginsDir, "disabled-by-manifest", "plugin.json"),
      JSON.stringify({ name: "disabled-by-manifest", disabled: true })
    );
    fs.writeFileSync(
      path.join(pluginsDir, "nested-manifest", ".antigravity-plugin", "plugin.json"),
      JSON.stringify({ name: "nested-manifest" })
    );
    fs.writeFileSync(
      path.join(pluginsDir, ".hidden-dir", "plugin.json"),
      JSON.stringify({ name: "hidden" })
    );

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        plugins: {
          "disabled-by-config": { enabled: false }
        }
      })
    );

    const installed = readInstalledPlugins(configPath, "plugins", "directory", [pluginsDir], "agy");
    expect(installed.map((p) => p.name)).toEqual(["enabled-plugin", "nested-manifest"]);
    expect(installed[0].targetAgent).toBe("agy");
    expect(installed[0].description).toBe("Active plugin");
    expect(installed[0].path).toBe(path.join(pluginsDir, "enabled-plugin"));

    // Works even when config.json does not exist yet
    const withoutConfig = readInstalledPlugins("", "plugins", "directory", [pluginsDir], "agy");
    expect(withoutConfig.map((p) => p.name)).toEqual([
      "disabled-by-config",
      "enabled-plugin",
      "nested-manifest"
    ]);
  });

  it("installs MCP, skills, directory plugins (with auto plugin.json), and custom subagents in project scope and uninstalls cleanly", () => {
    const profiles = sandboxAgyProfile(home, "project");
    const skillFiles = { "SKILL.md": "---\nname: agy-skill\ndescription: Skill for agy\n---\nInstructions" };
    const result = installPackIntoAgents(
      manifest({
        skills: [{ name: "agy-skill", path: "skills/agy-skill/SKILL.md", files: skillFiles }],
        plugins: [
          {
            name: "my-agy-bundle",
            files: {
              "skills/helper/SKILL.md": "---\nname: helper\ndescription: Helper\n---\nBody"
            }
          },
          {
            name: "opencode-only.ts",
            targetAgent: "opencode",
            files: { "opencode-only.ts": "export default {};" }
          }
        ],
        agents: [{ name: "auditor", description: "Security auditor", path: "agents/auditor.md" }]
      }),
      ["agy"],
      { remoteTool: { url: "https://mcp.example.com/mcp" } },
      {
        "agents/auditor.md": "---\nname: auditor\ndescription: Security auditor\ntools:\n  - view_file\n  - grep_search\n---\nAudit carefully."
      },
      undefined,
      profiles,
      undefined,
      "node",
      "project"
    );

    expect(result.installedMcp).toEqual(["agy"]);
    expect(result.installedSkills).toEqual(["agy"]);
    expect(result.installedPlugins).toEqual(["agy"]);
    expect(result.installedAgents).toEqual(["auditor"]);

    // Verify project files written to .agents/
    const mcpPath = path.join(proj, ".agents", "mcp_config.json");
    expect(fs.existsSync(mcpPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(mcpPath, "utf8")).mcpServers.remoteTool).toEqual({
      url: "https://mcp.example.com/mcp"
    });

    const skillPath = path.join(proj, ".agents", "skills", "agy-skill", "SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);

    const pluginDir = path.join(proj, ".agents", "plugins", "my-agy-bundle");
    expect(fs.existsSync(path.join(pluginDir, "plugin.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf8")).name).toBe("my-agy-bundle");
    expect(fs.existsSync(path.join(pluginDir, "skills", "helper", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(proj, ".agents", "plugins", "opencode-only.ts"))).toBe(false);

    const agentPath = path.join(proj, ".agents", "agents", "auditor.md");
    expect(fs.existsSync(agentPath)).toBe(true);
    const scannedAgents = scanAgents(path.join(proj, ".agents", "agents"));
    expect(scannedAgents).toHaveLength(1);
    expect(scannedAgents[0].name).toBe("auditor");
    expect(scannedAgents[0].tools).toEqual(["view_file", "grep_search"]);

    // Verify detectAgents finds project .agents/
    const detected = detectAgents(profiles);
    expect(detected).toHaveLength(1);
    expect(detected[0].id).toBe("agy");
    expect(detected[0].pluginsDirPath).toBe(path.join(proj, ".agents", "plugins"));

    // Uninstall cleanly
    const uninstalled = uninstallPackFromAgents(
      {
        name: "agy-pack",
        source: "local",
        version: "1.0.0",
        targetAgents: ["agy"],
        installedMcp: ["remoteTool"],
        installedSkills: ["agy-skill"],
        installedPlugins: ["my-agy-bundle"],
        installedAgents: ["auditor"],
        installedAt: new Date().toISOString()
      },
      profiles
    );

    expect(uninstalled.removedMcp).toEqual(["remoteTool"]);
    expect(uninstalled.removedSkills).toEqual(["agy-skill"]);
    expect(uninstalled.removedPlugins).toEqual(["my-agy-bundle"]);
    expect(uninstalled.removedAgents).toEqual(["auditor"]);
    expect(fs.existsSync(skillPath)).toBe(false);
    expect(fs.existsSync(pluginDir)).toBe(false);
    expect(fs.existsSync(agentPath)).toBe(false);
  });

  it("scans nested <name>/agent.md custom agents used by Antigravity", () => {
    const agentsDir = path.join(proj, ".agents", "agents");
    fs.mkdirSync(path.join(agentsDir, "nested-bot"), { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "nested-bot", "agent.md"),
      "---\nname: nested-bot\ndescription: Nested agy bot\n---\nNested instructions."
    );

    const scanned = scanAgents(agentsDir);
    expect(scanned).toHaveLength(1);
    expect(scanned[0].name).toBe("nested-bot");
    expect(scanned[0].description).toBe("Nested agy bot");
  });

  it("preserves existing config.json when installing directory plugins into global agy", () => {
    const profiles = sandboxAgyProfile(home, "global");
    const configFile = path.join(home, ".gemini", "config", "config.json");
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    const originalConfig = {
      plugins: {
        mobbin: {
          installedFrom: { id: "antigravity-plugins-partners/plugin/mobbin", version: "1.5.0" }
        }
      }
    };
    fs.writeFileSync(configFile, JSON.stringify(originalConfig, null, 2));

    const result = installPackIntoAgents(
      manifest({
        plugins: [
          {
            name: "custom-agy-plugin",
            targetAgent: "agy",
            files: {
              "plugin.json": JSON.stringify({ name: "custom-agy-plugin" }),
              "mcp_config.json": JSON.stringify({ mcpServers: {} })
            }
          }
        ]
      }),
      ["agy"],
      {},
      undefined,
      undefined,
      profiles,
      undefined,
      "node",
      "global"
    );

    expect(result.installedPlugins).toEqual(["agy"]);
    expect(JSON.parse(fs.readFileSync(configFile, "utf8"))).toEqual(originalConfig);
    expect(
      fs.existsSync(path.join(home, ".gemini", "config", "plugins", "custom-agy-plugin", "plugin.json"))
    ).toBe(true);
  });

  it("supports end-to-end CLI install, list, and uninstall targeting -a agy", () => {
    const packDir = path.join(tmp, "e2e-agy-pack");
    fs.mkdirSync(path.join(packDir, "skills", "agy-helper"), { recursive: true });
    fs.mkdirSync(path.join(packDir, "agents"), { recursive: true });

    fs.writeFileSync(
      path.join(packDir, "smcp.json"),
      JSON.stringify({
        name: "e2e-agy-pack",
        version: "1.0.0",
        mcpServers: {
          sqlite: { command: "npx", args: ["-y", "sqlite-mcp"] }
        },
        skills: [{ name: "agy-helper", path: "skills/agy-helper/SKILL.md" }],
        agents: [{ name: "agy-reviewer", path: "agents/agy-reviewer.md", description: "Reviews code" }]
      })
    );
    fs.writeFileSync(
      path.join(packDir, "skills", "agy-helper", "SKILL.md"),
      "---\nname: agy-helper\ndescription: Helper\n---\nHelp."
    );
    fs.writeFileSync(
      path.join(packDir, "agents", "agy-reviewer.md"),
      "---\nname: agy-reviewer\ndescription: Reviews code\n---\nReview."
    );

    const binSmcp = path.resolve(__dirname, "../packages/cli/dist/cli.js");
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      SMCP_DIR: path.join(home, ".smcp")
    };

    const installOut = execSync(
      `node "${binSmcp}" install "${packDir}" -a agy -f -y --global --json`,
      { cwd: proj, encoding: "utf8", env }
    );
    const parsedInstall = JSON.parse(installOut);
    expect(parsedInstall.success).toBe(true);
    expect(parsedInstall.targetAgents).toEqual(["agy"]);
    expect(parsedInstall.writtenPaths.agy.config).toBe(path.join(home, ".gemini", "config", "mcp_config.json"));
    expect(fs.existsSync(path.join(home, ".gemini", "config", "mcp_config.json"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".gemini", "config", "skills", "agy-helper", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".gemini", "config", "agents", "agy-reviewer.md"))).toBe(true);

    const listOut = execSync(
      `node "${binSmcp}" list -a agy --json`,
      { cwd: proj, encoding: "utf8", env }
    );
    const parsedList = JSON.parse(listOut);
    expect(parsedList.agents).toHaveLength(1);
    expect(parsedList.agents[0].id).toBe("agy");
    expect(parsedList.agents[0].mcpServers.sqlite).toBeDefined();
    expect(parsedList.agents[0].skills.some((s: { name: string }) => s.name === "agy-helper")).toBe(true);
    expect(parsedList.agents[0].agents.some((a: { name: string }) => a.name === "agy-reviewer")).toBe(true);

    const uninstallOut = execSync(
      `node "${binSmcp}" uninstall e2e-agy-pack -y --json`,
      { cwd: proj, encoding: "utf8", env }
    );
    expect(JSON.parse(uninstallOut).success).toBe(true);
    expect(fs.existsSync(path.join(home, ".gemini", "config", "skills", "agy-helper"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".gemini", "config", "agents", "agy-reviewer.md"))).toBe(false);
  });

  it("compiles universal agent via compileAgentForHarness for agy", () => {
    const compiled = compileAgentForHarness(
      { name: "planner", description: "Plans work", mode: "subagent", skills: [], prompt: "Plan carefully." },
      "agy"
    );
    expect(compiled.filename).toBe("planner.md");
    expect(compiled.content).toContain("subagent: true");
  });

  it("merges MCP servers cleanly into agy mcp_config.json", () => {
    const mcpPath = path.join(home, ".gemini", "config", "mcp_config.json");
    mergeMcpServersIntoFile(mcpPath, { grep: { url: "https://mcp.grep.app" } }, { agentId: "agy" });
    const parsed = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    expect(parsed.mcpServers.grep).toEqual({ url: "https://mcp.grep.app" });
  });

  it("normalizes gemini-extension httpUrl and includes legacy & _agents/_agent paths in DEFAULT_AGENTS.agy", () => {
    expect(DEFAULT_AGENTS.agy.mcpConfig?.paths).toContain("~/.gemini/antigravity/mcp_config.json");
    expect(DEFAULT_AGENTS.agy.mcpConfig?.paths).toContain("./.agent/mcp_config.json");
    expect(DEFAULT_AGENTS.agy.mcpConfig?.paths).toContain("./_agents/mcp_config.json");
    expect(DEFAULT_AGENTS.agy.rules?.paths).toContain("~/.gemini/GEMINI.md");
    expect(DEFAULT_AGENTS.agy.rules?.paths).toContain("./.agents/rules");
    expect(DEFAULT_AGENTS.agy.hooks?.paths).toContain("~/.gemini/config/hooks.json");

    const extMcp = path.join(home, "ext-mcp.json");
    fs.writeFileSync(
      extMcp,
      JSON.stringify({
        mcpServers: {
          mobbin: { httpUrl: "https://api.mobbin.com/mcp" }
        }
      })
    );
    const servers = readInstalledMcpServers(extMcp, "mcpServers");
    expect(servers.mobbin.url).toBe("https://api.mobbin.com/mcp");
    expect((servers.mobbin as Record<string, unknown>).httpUrl).toBeUndefined();
  });

  it("resolves Antigravity skills.json and plugins.json entries, inherits, include_only, and exclude", () => {
    const configRoot = path.join(home, ".gemini", "config");
    const primarySkills = path.join(configRoot, "skills");
    const sharedSkills = path.join(home, "shared-skills");
    const extraPlugins = path.join(home, "extra-plugins");
    fs.mkdirSync(path.join(sharedSkills, "kept-skill"), { recursive: true });
    fs.mkdirSync(path.join(sharedSkills, "skipped-skill"), { recursive: true });
    fs.mkdirSync(path.join(extraPlugins, "kept-plugin"), { recursive: true });
    fs.mkdirSync(path.join(extraPlugins, "excluded-plugin"), { recursive: true });

    fs.writeFileSync(path.join(sharedSkills, "kept-skill", "SKILL.md"), "---\nname: kept-skill\n---\nKept");
    fs.writeFileSync(path.join(sharedSkills, "skipped-skill", "SKILL.md"), "---\nname: skipped-skill\n---\nSkipped");
    fs.writeFileSync(path.join(extraPlugins, "kept-plugin", "plugin.json"), JSON.stringify({ name: "kept-plugin" }));
    fs.writeFileSync(path.join(extraPlugins, "excluded-plugin", "plugin.json"), JSON.stringify({ name: "excluded-plugin" }));

    const inheritedSkillsJson = path.join(home, "inherited-skills.json");
    fs.writeFileSync(
      inheritedSkillsJson,
      JSON.stringify({
        entries: [{ path: sharedSkills, include_only: ["kept-skill"] }]
      })
    );
    fs.mkdirSync(configRoot, { recursive: true });
    fs.writeFileSync(
      path.join(configRoot, "skills.json"),
      JSON.stringify({
        inherits: [{ path: inheritedSkillsJson }]
      })
    );
    fs.writeFileSync(
      path.join(configRoot, "plugins.json"),
      JSON.stringify({
        entries: [{ path: extraPlugins, exclude: ["excluded-.*"] }]
      })
    );

    const skills = scanSkills(primarySkills);
    expect(skills.map((s) => s.name)).toEqual(["kept-skill"]);

    const plugins = readInstalledPlugins("", "plugins", "directory", [path.join(configRoot, "plugins")], "agy");
    expect(plugins.map((p) => p.name)).toEqual(["kept-plugin"]);
  });

  it("scans, packs, installs, merges, and uninstalls Antigravity rules and standalone hooks.json", async () => {
    const configRoot = path.join(home, ".gemini", "config");
    const rulesDir = path.join(home, "workspace", ".agents", "rules");
    fs.mkdirSync(configRoot, { recursive: true });
    fs.mkdirSync(rulesDir, { recursive: true });

    const geminiRule = path.join(home, ".gemini", "GEMINI.md");
    fs.writeFileSync(geminiRule, "# Global Rule\nAlways verify.");
    fs.writeFileSync(path.join(rulesDir, "style.md"), "# Style Rule\nStrict TS.");
    fs.writeFileSync(
      path.join(configRoot, "hooks.json"),
      JSON.stringify({
        "lint-checker": {
          PostToolUse: [{ matcher: "run_command", hooks: [{ type: "command", command: "./lint.sh" }] }]
        }
      })
    );

    const scannedRules = scanRules([geminiRule, rulesDir, path.join(rulesDir, "style.md")]);
    expect(scannedRules.map((r) => r.name)).toEqual(["GEMINI", "style"]);

    const installedHooks = readInstalledHooks(path.join(configRoot, "hooks.json"));
    expect(installedHooks["lint-checker"]).toBeDefined();

    // Test merging hooks preserves existing hooks
    const destHooksPath = path.join(proj, ".agents", "hooks.json");
    fs.mkdirSync(path.dirname(destHooksPath), { recursive: true });
    fs.writeFileSync(destHooksPath, JSON.stringify({ "user-hook": { PreToolUse: [] } }));
    const merged = mergeHooksIntoFile(destHooksPath, installedHooks);
    expect(merged).toEqual(["lint-checker"]);
    const afterMerge = JSON.parse(fs.readFileSync(destHooksPath, "utf8"));
    expect(afterMerge["user-hook"]).toBeDefined();
    expect(afterMerge["lint-checker"]).toBeDefined();

    // Test packing and installing + uninstalling rules & hooks into sandbox agy profile
    const packSrc = path.join(home, "pack-src");
    fs.mkdirSync(path.join(packSrc, "rules"), { recursive: true });
    fs.mkdirSync(path.join(packSrc, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(packSrc, "rules", "safety.md"), "# Safety Rule\nBe careful.");
    fs.writeFileSync(
      path.join(packSrc, "hooks", "hooks.json"),
      JSON.stringify({ "pack-hook": { Stop: [{ command: "echo done" }] } })
    );
    const packed = await packDirectory(packSrc, { name: "rules-hooks-pack" });
    expect(packed.manifest.rules?.map((r) => r.name)).toEqual(["safety"]);
    expect(packed.manifest.hooks?.["pack-hook"]).toBeDefined();

    const agyProfile: Record<string, AgentProfile> = {
      agy: {
        name: "Antigravity",
        mcpConfig: { paths: [path.join(proj, ".agents", "mcp_config.json")], key: "mcpServers" },
        skills: { paths: [path.join(proj, ".agents", "skills")] },
        rules: { paths: [path.join(proj, ".agents", "rules")] },
        hooks: { paths: [path.join(proj, ".agents", "hooks.json")] }
      }
    };

    const installRes = installPackIntoAgents(
      packed.manifest,
      ["agy"],
      {},
      packed.rawFiles,
      packSrc,
      agyProfile,
      undefined,
      undefined,
      "project"
    );
    expect(installRes.installedRules).toEqual(["safety"]);
    expect(installRes.installedHooks).toEqual(["pack-hook"]);
    expect(fs.existsSync(path.join(proj, ".agents", "rules", "safety.md"))).toBe(true);

    const uninstallRes = uninstallPackFromAgents(
      {
        name: "rules-hooks-pack",
        source: packSrc,
        version: "1.0.0",
        targetAgents: ["agy"],
        installedMcp: [],
        installedSkills: [],
        installedPlugins: [],
        installedRules: installRes.installedRules,
        installedHooks: installRes.installedHooks,
        installedAt: new Date().toISOString()
      },
      agyProfile
    );
    expect(uninstallRes.removedRules).toEqual(["safety"]);
    expect(uninstallRes.removedHooks).toEqual(["pack-hook"]);
    expect(fs.existsSync(path.join(proj, ".agents", "rules", "safety.md"))).toBe(false);
    const remainingHooks = JSON.parse(fs.readFileSync(destHooksPath, "utf8"));
    expect(remainingHooks["user-hook"]).toBeDefined();
    expect(remainingHooks["pack-hook"]).toBeUndefined();
  });

  it("extracts MCP servers, skills, and subagents from Antigravity directory plugins when installing into non-directory agents", () => {
    const claudeMcp = path.join(home, ".claude.json");
    const claudeSkills = path.join(home, ".claude", "skills");
    const claudeAgents = path.join(home, ".claude", "agents");
    const profiles: Record<string, AgentProfile> = {
      "claude-code": {
        name: "Claude Code",
        mcpConfig: { paths: [claudeMcp], key: "mcpServers" },
        skills: { paths: [claudeSkills] },
        plugins: { paths: [path.join(home, ".claude", "settings.json")], key: "enabledPlugins", format: "map" },
        agents: { paths: [claudeAgents], format: "markdown" }
      }
    };

    const m = manifest({
      plugins: [
        {
          name: "mobbin",
          targetAgent: "agy",
          files: {
            "plugin.json": JSON.stringify({ name: "mobbin" }),
            "gemini-extension.json": JSON.stringify({
              name: "mobbin",
              mcpServers: {
                mobbin: { httpUrl: "https://api.mobbin.com/mcp" }
              }
            }),
            "skills/redesign/SKILL.md": "---\nname: redesign\ndescription: Redesign screen\n---\nInstructions",
            "agents/reviewer.md": "---\nname: reviewer\ndescription: Design reviewer\nmode: subagent\n---\nReview UI."
          }
        }
      ]
    });

    installPackIntoAgents(m, ["claude-code"], {}, undefined, undefined, profiles, undefined, undefined, "global");

    const mcpParsed = JSON.parse(fs.readFileSync(claudeMcp, "utf8"));
    expect(mcpParsed.mcpServers.mobbin).toEqual({
      url: "https://api.mobbin.com/mcp",
      type: "http"
    });
    expect(fs.existsSync(path.join(claudeSkills, "redesign", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(claudeAgents, "reviewer.md"))).toBe(true);
  });
});
