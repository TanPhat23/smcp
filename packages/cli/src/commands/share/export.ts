import fs from "node:fs";
import path from "node:path";
import {
  atomicWriteFileSync,
  installPluginFiles,
  installSkillFiles,
  isStrictlyInside,
  type AgentEntry,
  type Manifest,
  type PluginEntry,
  type SkillEntry
} from "@tanphat/smcp-core";

export function exportPackLocally(
  manifest: Manifest,
  bundledSkills: SkillEntry[],
  outputDir: string,
  bundledPlugins?: PluginEntry[],
  bundledAgents?: (AgentEntry & { rawContent?: string })[]
): void {
  const outDir = path.resolve(outputDir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "smcp.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  if (manifest.mcpServers && Object.keys(manifest.mcpServers).length > 0) {
    atomicWriteFileSync(
      path.join(outDir, "mcp", "mcp.json"),
      JSON.stringify({ mcpServers: manifest.mcpServers }, null, 2) + "\n"
    );
  }

  for (const sk of bundledSkills) {
    if (sk.files) {
      installSkillFiles(path.join(outDir, "skills"), sk.name, sk.files);
    }
  }

  if (bundledPlugins && bundledPlugins.length > 0) {
    for (const pl of bundledPlugins) {
      if (typeof pl === "object" && pl.files && Object.keys(pl.files).length > 0) {
        installPluginFiles(path.join(outDir, "plugins"), pl.name, pl.files);
      }
    }
  }

  if (bundledAgents && bundledAgents.length > 0) {
    const agentsDir = path.resolve(outDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const ag of bundledAgents) {
      if (ag.rawContent) {
        const safeName = path.basename(ag.name);
        const targetPath = path.resolve(agentsDir, `${safeName}.md`);
        if (!isStrictlyInside(agentsDir, targetPath)) {
          continue;
        }
        atomicWriteFileSync(targetPath, ag.rawContent);
      }
    }
  }

  if (manifest.rules && manifest.rules.length > 0) {
    const rulesDir = path.resolve(outDir, "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    for (const rule of manifest.rules) {
      if (typeof rule.content === "string") {
        const safeName = path.basename(rule.name);
        const targetPath = path.resolve(rulesDir, `${safeName}.md`);
        if (isStrictlyInside(rulesDir, targetPath)) {
          atomicWriteFileSync(targetPath, rule.content);
        }
      }
    }
  }

  if (manifest.hooks && Object.keys(manifest.hooks).length > 0) {
    atomicWriteFileSync(
      path.join(outDir, "hooks", "hooks.json"),
      JSON.stringify(manifest.hooks, null, 2) + "\n"
    );
  }
}
