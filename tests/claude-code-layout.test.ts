import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPackIntoAgents } from "../packages/cli/src/commands/install/index.ts";
import {
  DEFAULT_AGENTS,
  compileAgentForHarness,
  filterAgents,
  parseAgentMarkdown,
  readInstalledMcpServers,
  scanAgents
} from "../packages/core/src/core/agents/index.ts";
import { mergeMcpServersIntoFile, mergePluginsIntoFile, uninstallPackFromAgents } from "../packages/core/src/core/merger/index.ts";
import type { Manifest } from "../packages/core/src/types/index.ts";

/** Claude Code profile re-pointed at sandbox files so tests can never touch the real ~/.claude*. */
function sandboxProfile(mcpFile: string, settingsFile: string) {
  return {
    "claude-code": {
      ...DEFAULT_AGENTS["claude-code"],
      mcpConfig: { paths: [mcpFile], key: "mcpServers" },
      skills: null,
      plugins: { paths: [settingsFile], key: "enabledPlugins", format: "map" as const },
      agents: null
    }
  };
}

/** Mirrors the on-disk shape of a real ~/.claude.json (auth, onboarding state, per-project servers). */
function realClaudeJson(cwd: string) {
  return {
    numStartups: 412,
    installMethod: "native",
    oauthAccount: { emailAddress: "someone@example.com", organizationUuid: "00000000-0000-0000-0000-000000000000" },
    hasCompletedOnboarding: true,
    mcpServers: {},
    projects: {
      [cwd]: {
        allowedTools: [],
        mcpServers: { webbuilder: { type: "stdio", command: "node", args: ["web.js"], env: {} } },
        hasTrustDialogAccepted: true
      }
    }
  };
}

describe("Claude Code on-disk layout", () => {
  let tmp: string;
  let proj: string;
  let home: string;
  let origCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-claude-layout-"));
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
    ({ name: "pack", version: "1.0.0", mcpServers: {}, skills: [], plugins: [], requiredEnv: [], ...extra }) as Manifest;

  it("corrupt ~/.claude.json is never replaced", () => {
    const file = path.join(home, ".claude.json");
    const truncated = JSON.stringify(realClaudeJson(proj)).slice(0, 120);
    fs.writeFileSync(file, truncated);
    expect(() => mergeMcpServersIntoFile(file, { foo: { command: "x" } }, { agentId: "claude-code" })).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(truncated);
  });

  it("corrupt settings.json is never replaced by plugin merge", () => {
    const file = path.join(home, "settings.json");
    fs.writeFileSync(file, '{"permissions": {');
    expect(() => mergePluginsIntoFile(file, ["a@b"], "enabledPlugins", "map")).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe('{"permissions": {');
  });

  it("merge preserves every unrelated key of a real ~/.claude.json", () => {
    const file = path.join(home, ".claude.json");
    const original = realClaudeJson(proj);
    fs.writeFileSync(file, JSON.stringify(original));
    mergeMcpServersIntoFile(file, { foo: { command: "npx", args: ["foo"] } }, { agentId: "claude-code" });
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(after.oauthAccount).toEqual(original.oauthAccount);
    expect(after.projects).toEqual(original.projects);
    expect(after.numStartups).toBe(412);
    expect(after.mcpServers.foo.command).toBe("npx");
  });

  it("project scope writes only files Claude Code reads", () => {
    const skillFiles = { "SKILL.md": "---\nname: s\ndescription: d\n---\nbody" };
    const result = installPackIntoAgents(
      manifest({
        skills: [{ name: "s", files: skillFiles } as any],
        plugins: ["ctx@claude-plugins-official"],
        agents: [{ name: "rev", description: "Reviewer", path: "rev.md" } as any]
      }),
      ["claude-code"],
      { srv: { command: "node", args: ["a.js"] } },
      { "skills/s/SKILL.md": skillFiles["SKILL.md"], "rev.md": "---\nname: rev\ndescription: Reviewer\n---\nPrompt" },
      undefined,
      undefined,
      undefined,
      "node",
      "project"
    );
    expect(result.installedMcp).toEqual(["claude-code"]);
    expect(fs.existsSync(path.join(proj, ".mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(proj, ".claude.json"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(proj, ".mcp.json"), "utf8")).mcpServers.srv.command).toBe("node");
    expect(fs.existsSync(path.join(proj, ".claude", "settings.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(proj, ".claude", "settings.json"), "utf8")).enabledPlugins).toEqual({
      "ctx@claude-plugins-official": true
    });
    expect(fs.existsSync(path.join(proj, "skills"))).toBe(false);
    expect(fs.existsSync(path.join(proj, ".claude", "agents", "rev.md"))).toBe(true);
    expect(fs.existsSync(path.join(proj, ".claude", "commands"))).toBe(false);
  });

  it("agents compile to subagents that scan back with name/tools/model intact", () => {
    const { filename, content } = compileAgentForHarness(
      { name: "rev", description: "Reviewer", mode: "subagent", model: "opus", tools: ["Read", "Grep"], prompt: "Be strict." },
      "claude-code"
    );
    expect(content).not.toContain("$ARGUMENTS");
    const dir = path.join(home, ".claude", "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), content);
    const scanned = scanAgents(dir);
    expect(scanned).toHaveLength(1);
    expect(scanned[0].name).toBe("rev");
    expect(scanned[0].model).toBe("opus");
    expect(scanned[0].tools).toEqual(["Read", "Grep"]);
    expect(scanned[0].prompt.trim()).toBe("Be strict.");
  });

  it("parses a hand-written Claude subagent with comma-separated tools", () => {
    const a = parseAgentMarkdown("---\nname: x\ndescription: d\ntools: Read, Bash\nmodel: inherit\n---\nhi");
    expect(a.tools).toEqual(["Read", "Bash"]);
  });

  it("remote servers get an explicit transport type on Claude Code only", () => {
    const cc = path.join(home, ".claude.json");
    mergeMcpServersIntoFile(cc, { remote: { url: "https://x.dev/mcp" }, ev: { url: "https://x.dev/sse" } } as any, {
      agentId: "claude-code"
    });
    const parsed = JSON.parse(fs.readFileSync(cc, "utf8")).mcpServers;
    expect(parsed.remote.type).toBe("http");
    expect(parsed.ev.type).toBe("sse");

    const cursor = path.join(home, "cursor.json");
    mergeMcpServersIntoFile(cursor, { remote: { url: "https://x.dev/mcp" } } as any, { agentId: "cursor" });
    expect(JSON.parse(fs.readFileSync(cursor, "utf8")).mcpServers.remote.type).toBeUndefined();
  });

  it("list sees project-scoped servers next to an empty top-level mcpServers", () => {
    const file = path.join(home, ".claude.json");
    fs.writeFileSync(file, JSON.stringify(realClaudeJson(proj)));
    expect(Object.keys(readInstalledMcpServers(file))).toEqual(["webbuilder"]);

    const withUser = { ...realClaudeJson(proj), mcpServers: { user: { command: "u" } } };
    fs.writeFileSync(file, JSON.stringify(withUser));
    expect(Object.keys(readInstalledMcpServers(file)).sort()).toEqual(["user", "webbuilder"]);
  });

  it("uninstall removes servers atomically from ~/.claude.json (incl. projects) and enabledPlugins", () => {
    const file = path.join(home, ".claude.json");
    const data = realClaudeJson(proj) as any;
    data.mcpServers = { foo: { command: "x" }, keep: { command: "k" } };
    fs.writeFileSync(file, JSON.stringify(data));
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    const settings = path.join(home, ".claude", "settings.json");
    fs.writeFileSync(settings, JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, enabledPlugins: { "a@m": true, "b@m": true } }));

    const res = uninstallPackFromAgents(
      {
        name: "p", source: "s", version: "1", targetAgents: ["claude-code"], installedMcp: ["foo", "webbuilder"],
        installedSkills: [], installedPlugins: ["a@m"], installedAt: "now"
      } as any,
      sandboxProfile(file, settings)
    );
    expect(res.removedMcp.sort()).toEqual(["foo", "webbuilder"]);
    expect(res.removedPlugins).toEqual(["a@m"]);
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(Object.keys(after.mcpServers)).toEqual(["keep"]);
    expect(after.projects[proj].mcpServers).toEqual({});
    expect(after.oauthAccount).toBeDefined();
    expect(JSON.parse(fs.readFileSync(settings, "utf8"))).toEqual({
      permissions: { allow: ["Bash(ls)"] },
      enabledPlugins: { "b@m": true }
    });
  });

  it("uninstall leaves a corrupt ~/.claude.json untouched", () => {
    const file = path.join(home, ".claude.json");
    fs.writeFileSync(file, '{"mcpServers": {"foo"');
    uninstallPackFromAgents(
      { name: "p", source: "s", version: "1", targetAgents: ["claude-code"], installedMcp: ["foo"], installedSkills: [], installedPlugins: [], installedAt: "n" } as any,
      sandboxProfile(file, path.join(home, "none.json"))
    );
    expect(fs.readFileSync(file, "utf8")).toBe('{"mcpServers": {"foo"');
  });

  it("-a claude selects Claude Code but not Claude Desktop", () => {
    const agents = ["claude-code", "claude-desktop", "cursor"].map((id) => ({
      id, name: id === "claude-code" ? "Claude Code" : id === "claude-desktop" ? "Claude Desktop" : "Cursor",
      mcpConfigPath: null, skillsDirPath: null
    }));
    expect(filterAgents(agents, ["claude"]).map((a) => a.id)).toEqual(["claude-code"]);
  });
});
