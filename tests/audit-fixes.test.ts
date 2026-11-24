import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectDirectoryFilesAsync,
  generatePackReadme,
  installPluginFiles,
  isIgnoredPath,
  readGistCache,
  type Manifest
} from "../packages/core/src/index.ts";
import { selectRelevantRepoBlobs } from "../packages/core/src/core/git-providers/repo-utils.ts";
import { extractPluginFiles, extractSkillFiles } from "../packages/cli/src/commands/install/extract.ts";
import { discoverPackComponents } from "../packages/cli/src/commands/pack/discovery.ts";
import { packDirectory } from "../packages/cli/src/commands/pack/pack.ts";
import { bundleSkillFiles } from "../packages/cli/src/commands/share/bundle.ts";

describe("Codebase audit & security/performance fixes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-audit-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("ignores Antigravity .in_use lock directories and venv/__pycache__ artifacts when bundling", async () => {
    expect(isIgnoredPath("plugins/pstack/.in_use/243654")).toBe(true);
    expect(isIgnoredPath(".venv/lib/python.py")).toBe(true);
    expect(isIgnoredPath("__pycache__/mod.py")).toBe(true);

    const pluginDir = path.join(tempDir, "my-plugin");
    fs.mkdirSync(path.join(pluginDir, ".in_use"), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, ".in_use", "243654"), "pid");
    fs.writeFileSync(path.join(pluginDir, "plugin.json"), JSON.stringify({ name: "my-plugin" }));

    const collected = await collectDirectoryFilesAsync(pluginDir);
    expect(collected["plugin.json"]).toBeDefined();
    expect(collected[".in_use/243654"]).toBeUndefined();

    const skillDir = path.join(tempDir, "my-skill");
    fs.mkdirSync(path.join(skillDir, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Skill");
    fs.writeFileSync(path.join(skillDir, "node_modules", "pkg", "index.js"), "ignored");

    const { bundledSkills } = bundleSkillFiles([
      { name: "my-skill", path: path.join(skillDir, "SKILL.md") }
    ]);
    expect(Object.keys(bundledSkills[0].files || {})).toEqual(["SKILL.md"]);
  });

  it("selectRelevantRepoBlobs skips already-inlined skill/plugin blobs and ignored runtime paths", () => {
    const manifest: Manifest = {
      name: "gemini",
      version: "1.0.0",
      skills: [
        { name: "inline-skill", path: "skills/inline-skill/SKILL.md", files: { "SKILL.md": "# Hi" } },
        { name: "empty-skill", path: "skills/empty-skill/SKILL.md" }
      ],
      plugins: [
        { name: "inline-plugin", files: { "plugin.json": "{}" } },
        "external-plugin"
      ]
    };

    const tree = [
      { path: "README.md" },
      { path: "agents/reviewer.md" },
      { path: "skills/inline-skill/SKILL.md" },
      { path: "skills/empty-skill/SKILL.md" },
      { path: "plugins/inline-plugin/plugin.json" },
      { path: "plugins/inline-plugin/skills/a/SKILL.md" },
      { path: "plugins/inline-plugin/.in_use/999" },
      { path: "plugins/external-plugin/index.ts" },
      { path: "plugins/external-plugin/.in_use/123" }
    ];

    const selected = selectRelevantRepoBlobs(tree, manifest).map((b) => b.path);
    expect(selected).toEqual([
      "README.md",
      "agents/reviewer.md",
      "skills/empty-skill/SKILL.md",
      "plugins/external-plugin/index.ts"
    ]);
  });

  it("rejects empty or dot relative paths inside directory plugins in installPluginFiles", () => {
    const pluginsDir = path.join(tempDir, "plugins");
    expect(() => installPluginFiles(pluginsDir, "my-plugin", { "": "oops" })).toThrow(/traversal/i);
    expect(() => installPluginFiles(pluginsDir, "my-plugin", { ".": "oops" })).toThrow(/traversal/i);
  });

  it("sanitizes path traversal characters in readGistCache ids", () => {
    expect(readGistCache("../etc/passwd")).toBeNull();
    expect(readGistCache("..")).toBeNull();
  });

  it("extracts nested repo skill and plugin paths before flattened gist aliases", () => {
    const rawFiles = {
      "skills/nested/sub/guide.md": "nested guide",
      "skills_nested_sub_guide.md": "flattened fallback",
      "plugins/pstack/skills/tdd/SKILL.md": "tdd skill",
      "plugins_pstack_skills_tdd_SKILL.md": "flattened plugin fallback"
    };

    const skillFiles = extractSkillFiles({ name: "nested", path: "skills/nested/SKILL.md" }, rawFiles);
    expect(skillFiles["sub/guide.md"]).toBe("nested guide");

    const pluginFiles = extractPluginFiles("pstack", rawFiles);
    expect(pluginFiles["skills/tdd/SKILL.md"]).toBe("tdd skill");
  });

  it("discovers and emits standalone mcp/mcp.json and documents it in README.md", async () => {
    const packRoot = path.join(tempDir, "my-pack");
    const outRoot = path.join(tempDir, "packed");
    fs.mkdirSync(path.join(packRoot, "mcp"), { recursive: true });
    fs.writeFileSync(
      path.join(packRoot, "mcp", "mcp.json"),
      JSON.stringify({ mcpServers: { grep: { url: "https://mcp.grep.app" } } }, null, 2)
    );

    const components = discoverPackComponents(packRoot);
    expect(components.mcpServers?.grep?.url).toBe("https://mcp.grep.app");

    const packed = await packDirectory(packRoot, { outputDir: outRoot });
    expect(packed.manifest.mcpServers?.grep?.url).toBe("https://mcp.grep.app");
    expect(fs.existsSync(path.join(outRoot, "mcp", "mcp.json"))).toBe(true);

    const readme = generatePackReadme(packed.manifest, "TanPhat23/gemini");
    expect(readme).toContain("[`mcp/mcp.json`](mcp/mcp.json)");
    expect(readme).toContain("- **grep**: `https://mcp.grep.app`");
  });
});
