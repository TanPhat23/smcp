import { describe, expect, it, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createProgram } from "../packages/cli/src/cli.ts";
import { discoverPackComponents } from "../packages/cli/src/commands/pack/discovery.ts";
import { inspectCommand } from "../packages/cli/src/commands/inspect.ts";
import { bundleAgentFiles, packCommand, packDirectory } from "../packages/cli/src/commands/pack/pack.ts";
import { formatInspectAgents } from "../packages/cli/src/commands/inspect.ts";
import { exportPackLocally } from "../packages/cli/src/commands/share/export.ts";

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-test-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tmpDirs.length = 0;
});

describe("Pack Discovery & Inspect with Agents", () => {
  it("discovers agents in agents/ directory during pack discovery", () => {
    const tmp = makeTmpDir();
    const agentsDir = path.join(tmp, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "reviewer.md"),
      `---\nname: reviewer\ndescription: Adversarial code reviewer\nmode: subagent\n---\nReview code.`
    );

    const components = discoverPackComponents(tmp);
    expect(components.agents).toBeDefined();
    expect(components.agents?.length).toBe(1);
    expect(components.agents?.[0].name).toBe("reviewer");
    expect(components.agents?.[0].description).toBe("Adversarial code reviewer");
  });

  it("inspects a pack with agents and outputs formatted agent info in JSON mode", async () => {
    const tmp = makeTmpDir();
    fs.writeFileSync(
      path.join(tmp, "smcp.json"),
      JSON.stringify({
        name: "agent-test-pack",
        version: "1.0.0",
        agents: [
          { name: "reviewer", description: "Adversarial code reviewer", mode: "subagent" }
        ]
      })
    );

    // Test inspect with JSON option
    let capturedLog = "";
    const originalLog = console.log;
    console.log = (msg: string) => { capturedLog += msg; };

    try {
      await inspectCommand(tmp, { json: true });
      const parsed = JSON.parse(capturedLog);
      expect(parsed.agents).toBeDefined();
      expect(parsed.agents.length).toBe(1);
      expect(parsed.agents[0].name).toBe("reviewer");
    } finally {
      console.log = originalLog;
    }
  });

  it("inspects a pack with agents and prints human-readable agent summary", async () => {
    const tmp = makeTmpDir();
    fs.writeFileSync(
      path.join(tmp, "smcp.json"),
      JSON.stringify({
        name: "human-agent-pack",
        version: "1.0.0",
        agents: [
          { name: "planner", description: "Architecture planner", mode: "subagent" },
          { name: "coder", description: "Core implementer", mode: "primary" }
        ]
      })
    );

    let capturedLog = "";
    const originalLog = console.log;
    console.log = (msg: string) => { capturedLog += msg + "\n"; };

    try {
      await inspectCommand(tmp, { json: false });
      expect(capturedLog).toContain("🤖 Agents (2):");
      expect(capturedLog).toContain("planner");
      expect(capturedLog).toContain("Architecture planner");
      expect(capturedLog).toContain("coder");
      expect(capturedLog).toContain("primary");
    } finally {
      console.log = originalLog;
    }
  });

  it("bundles discovered agent files into pack manifest and raw files", async () => {
    const tmp = makeTmpDir();
    const agentsDir = path.join(tmp, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const agentRaw = `---\nname: auditor\ndescription: Security auditor\nmode: subagent\nmodel: claude-3-7-sonnet\n---\nAudit security posture.`;
    fs.writeFileSync(path.join(agentsDir, "auditor.md"), agentRaw);

    const components = discoverPackComponents(tmp);
    expect(components.agents).toBeDefined();

    const bundled = bundleAgentFiles(components.agents!);
    expect(bundled.bundledAgents.length).toBe(1);
    expect(bundled.bundledAgents[0].name).toBe("auditor");
    expect(bundled.bundledAgents[0].mode).toBe("subagent");
    expect(bundled.bundledAgents[0].model).toBe("claude-3-7-sonnet");
    expect(bundled.rawFiles["agents/auditor.md"]).toBe(agentRaw);
    expect(bundled.gistFiles["agents_auditor.md"]).toEqual({ content: agentRaw });

    const packOutDir = path.join(tmp, "dist");
    const packResult = await packDirectory(tmp, { outputDir: packOutDir });
    expect(packResult.manifest.agents?.length).toBe(1);
    expect(packResult.manifest.agents?.[0].name).toBe("auditor");
    expect(fs.existsSync(path.join(packOutDir, "agents", "auditor.md"))).toBe(true);
    expect(fs.readFileSync(path.join(packOutDir, "agents", "auditor.md"), "utf8")).toBe(agentRaw);
    expect(fs.existsSync(path.join(packOutDir, "smcp.json"))).toBe(true);
  });

  it("ignores non-markdown files and hidden files in agents directory", () => {
    const tmp = makeTmpDir();
    const agentsDir = path.join(tmp, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, ".DS_Store"), "binary junk");
    fs.writeFileSync(path.join(agentsDir, "notes.txt"), "some notes");
    fs.writeFileSync(
      path.join(agentsDir, "valid.md"),
      `---\nname: valid\ndescription: Valid agent\n---\nPrompt`
    );

    const components = discoverPackComponents(tmp);
    expect(components.agents?.length).toBe(1);
    expect(components.agents?.[0].name).toBe("valid");
  });

  it("handles directory without agents/ gracefully", () => {
    const tmp = makeTmpDir();
    const components = discoverPackComponents(tmp);
    expect(components.agents).toBeUndefined();
  });

  it("packCommand produces valid json output with agents", async () => {
    const tmp = makeTmpDir();
    const agentsDir = path.join(tmp, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "worker.md"),
      `---\nname: worker\ndescription: Background worker agent\n---\nDo work.`
    );

    let capturedLog = "";
    const originalLog = console.log;
    console.log = (msg: string) => { capturedLog += msg; };

    try {
      const result = await packCommand(tmp, { json: true });
      expect(result).not.toBeNull();
      const parsed = JSON.parse(capturedLog);
      expect(parsed.success).toBe(true);
      expect(parsed.manifest.agents.length).toBe(1);
      expect(parsed.manifest.agents[0].name).toBe("worker");
      expect(parsed.files).toContain("agents/worker.md");
    } finally {
      console.log = originalLog;
    }
  });

  it("formatInspectAgents returns properly formatted string", () => {
    const output = formatInspectAgents([
      { name: "test-bot", description: "A helpful bot", mode: "primary" }
    ]);
    expect(output).toContain("🤖 Agents (1):");
    expect(output).toContain("test-bot (primary) — A helpful bot");

    const emptyOutput = formatInspectAgents([]);
    expect(emptyOutput).toContain("🤖 Agents (0):");
    expect(emptyOutput).toContain("(none)");
  });

  it("throws descriptive error when agent markdown has invalid frontmatter", () => {
    const tmp = makeTmpDir();
    const agentsDir = path.join(tmp, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "invalid.md"),
      `---\nname: invalid agent with spaces\n---\nPrompt`
    );

    expect(() => discoverPackComponents(tmp)).toThrow(/Invalid frontmatter/);
  });

  it("packs a directory via CLI option -o into target outDir", async () => {
    const tmp = makeTmpDir();
    const agentsDir = path.join(tmp, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "cli-bot.md"),
      `---\nname: cli-bot\ndescription: CLI test bot\nmode: subagent\n---\nCLI Prompt.`
    );

    const outDir = path.join(tmp, "cli-packed-output");
    const program = createProgram();
    await program.parseAsync(["node", "smcp", "pack", tmp, "-o", outDir, "--no-plugins", "--no-extensions"]);

    expect(fs.existsSync(path.join(outDir, "smcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "agents", "cli-bot.md"))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "smcp.json"), "utf8"));
    expect(manifest.agents?.length).toBe(1);
    expect(manifest.agents?.[0].name).toBe("cli-bot");
  });

  it("guards against path traversal in bundleAgentFiles and packDirectory", async () => {
    const tmp = makeTmpDir();
    const baseDir = path.join(tmp, "workspace");
    fs.mkdirSync(baseDir, { recursive: true });

    // Agent escaping baseDir
    const result = bundleAgentFiles(
      [
        { name: "bad-agent", path: "../../outside.md" },
        { name: "good-agent", path: "agents/good.md" }
      ],
      baseDir
    );

    // Only good-agent bundled
    expect(result.bundledAgents.some((a) => a.name === "bad-agent")).toBe(false);
    expect(result.bundledAgents.some((a) => a.name === "good-agent")).toBe(true);
  });

  it("exportPackLocally sanitizes agent names and writes agent files inside agentsDir", () => {
    const tmp = makeTmpDir();
    const exportOut = path.join(tmp, "exported");

    exportPackLocally(
      {
        name: "test-export",
        version: "1.0.0"
      },
      [],
      exportOut,
      [],
      [
        {
          name: "../../escaped-agent",
          mode: "subagent",
          rawContent: "---\nname: escaped\n---\nPrompt"
        },
        {
          name: "normal-agent",
          mode: "subagent",
          rawContent: "---\nname: normal\n---\nNormal prompt"
        }
      ]
    );

    // Verify sanitized write: basename only
    const agentsDir = path.join(exportOut, "agents");
    expect(fs.existsSync(path.join(agentsDir, "escaped-agent.md"))).toBe(true);
    expect(fs.existsSync(path.join(agentsDir, "normal-agent.md"))).toBe(true);
    // Verify file did not escape outDir
    expect(fs.existsSync(path.join(tmp, "escaped-agent.md"))).toBe(false);
  });
});
