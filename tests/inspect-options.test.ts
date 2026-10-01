import { describe, expect, it, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { inspectCommand } from "../packages/cli/src/commands/inspect.ts";

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-inspect-test-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tmpDirs.length = 0;
});

describe("smcp inspect options", () => {
  function createSamplePack(): string {
    const tmp = makeTmpDir();
    const manifest = {
      name: "sample-pack",
      version: "1.2.0",
      description: "A sample pack for testing inspection options",
      mcpServers: {
        "grep-server": {
          command: "bunx",
          args: ["-y", "grep-server"]
        }
      },
      skills: [
        {
          name: "format-skill",
          description: "Formats code cleanly",
          path: "skills/format-skill/SKILL.md",
          files: {
            "SKILL.md": "# Format Skill\nInstructions on formatting."
          }
        },
        {
          name: "lint-skill",
          description: "Lints code",
          path: "skills/lint-skill/SKILL.md",
          files: {
            "SKILL.md": "# Lint Skill\nInstructions on linting."
          }
        }
      ],
      agents: [
        {
          name: "auditor",
          description: "Audits security",
          mode: "subagent",
          path: "agents/auditor.md"
        }
      ]
    };
    fs.writeFileSync(path.join(tmp, "smcp.json"), JSON.stringify(manifest, null, 2));
    const skillDir = path.join(tmp, "skills", "format-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Format Skill\nInstructions on formatting.");

    const agentDir = path.join(tmp, "agents");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "auditor.md"), "---\nname: auditor\ndescription: Audits security\nmode: subagent\n---\nYou audit security.");

    return tmp;
  }

  it("inspects a specific skill with --skill in json mode", async () => {
    const packDir = createSamplePack();
    let capturedLog = "";
    const originalLog = console.log;
    console.log = (msg: string) => { capturedLog += msg; };

    try {
      await inspectCommand(packDir, { json: true, skill: "format-skill" });
      const parsed = JSON.parse(capturedLog);
      expect(parsed.pack).toBe("sample-pack");
      expect(parsed.skill).toBeDefined();
      expect(parsed.skill.name).toBe("format-skill");
      expect(parsed.skill.description).toBe("Formats code cleanly");
      expect(parsed.skill.files).toBeDefined();
      expect(parsed.skill.files["SKILL.md"]).toContain("Format Skill");
    } finally {
      console.log = originalLog;
    }
  });

  it("returns error in json mode when specified skill is not found", async () => {
    const packDir = createSamplePack();
    let capturedErr = "";
    const originalErr = console.error;
    console.error = (msg: string) => { capturedErr += msg; };

    try {
      const res = await inspectCommand(packDir, { json: true, skill: "missing-skill" });
      expect(res).toBeNull();
      const parsed = JSON.parse(capturedErr);
      expect(parsed.error).toContain("missing-skill");
    } finally {
      console.error = originalErr;
    }
  });

  it("inspects a specific agent with --agent in json mode", async () => {
    const packDir = createSamplePack();
    let capturedLog = "";
    const originalLog = console.log;
    console.log = (msg: string) => { capturedLog += msg; };

    try {
      await inspectCommand(packDir, { json: true, agent: "auditor" });
      const parsed = JSON.parse(capturedLog);
      expect(parsed.pack).toBe("sample-pack");
      expect(parsed.agent).toBeDefined();
      expect(parsed.agent.name).toBe("auditor");
      expect(parsed.agent.mode).toBe("subagent");
      expect(parsed.content).toContain("You audit security");
    } finally {
      console.log = originalLog;
    }
  });

  it("inspects a specific server with --server in json mode", async () => {
    const packDir = createSamplePack();
    let capturedLog = "";
    const originalLog = console.log;
    console.log = (msg: string) => { capturedLog += msg; };

    try {
      await inspectCommand(packDir, { json: true, server: "grep-server" });
      const parsed = JSON.parse(capturedLog);
      expect(parsed.pack).toBe("sample-pack");
      expect(parsed.server).toBeDefined();
      expect(parsed.server.name).toBe("grep-server");
      expect(parsed.server.config.command).toBe("bunx");
    } finally {
      console.log = originalLog;
    }
  });

  it("filters output to only skills with --skills in json mode", async () => {
    const packDir = createSamplePack();
    let capturedLog = "";
    const originalLog = console.log;
    console.log = (msg: string) => { capturedLog += msg; };

    try {
      await inspectCommand(packDir, { json: true, skills: true });
      const parsed = JSON.parse(capturedLog);
      expect(parsed.skills).toBeDefined();
      expect(parsed.skills.length).toBe(2);
      expect(parsed.mcpServers).toBeUndefined();
      expect(parsed.agents).toBeUndefined();
    } finally {
      console.log = originalLog;
    }
  });

  it("inspects a specific skill in text mode", async () => {
    const packDir = createSamplePack();
    let capturedLog = "";
    const originalLog = console.log;
    console.log = (msg: string) => { capturedLog += msg + "\n"; };

    try {
      const res = await inspectCommand(packDir, { skill: "format-skill" });
      expect(res).toBeDefined();
      expect(capturedLog).toContain("format-skill");
      expect(capturedLog).toContain("Format Skill");
      expect(capturedLog).toContain("SKILL.md");
    } finally {
      console.log = originalLog;
    }
  });

  it("inspects a specific agent in text mode", async () => {
    const packDir = createSamplePack();
    let capturedLog = "";
    const originalLog = console.log;
    console.log = (msg: string) => { capturedLog += msg + "\n"; };

    try {
      const res = await inspectCommand(packDir, { agent: "auditor" });
      expect(res).toBeDefined();
      expect(capturedLog).toContain("auditor");
      expect(capturedLog).toContain("You audit security");
    } finally {
      console.log = originalLog;
    }
  });

  it("inspects a specific server in text mode", async () => {
    const packDir = createSamplePack();
    let capturedLog = "";
    const originalLog = console.log;
    console.log = (msg: string) => { capturedLog += msg + "\n"; };

    try {
      const res = await inspectCommand(packDir, { server: "grep-server" });
      expect(res).toBeDefined();
      expect(capturedLog).toContain("grep-server");
      expect(capturedLog).toContain("bunx");
    } finally {
      console.log = originalLog;
    }
  });

  it("filters output in text mode with category flags", async () => {
    const packDir = createSamplePack();
    let capturedLog = "";
    const originalLog = console.log;
    console.log = (msg: string) => { capturedLog += msg + "\n"; };

    try {
      const res = await inspectCommand(packDir, { skills: true });
      expect(res).toBeDefined();
      expect(capturedLog).toContain("format-skill");
      expect(capturedLog).toContain("lint-skill");
      expect(capturedLog).not.toContain("grep-server");
    } finally {
      console.log = originalLog;
    }
  });
});
