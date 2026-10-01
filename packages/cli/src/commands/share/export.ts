import fs from "node:fs";
import path from "node:path";
import {
  installPluginFiles,
  installSkillFiles,
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
    const agentsDir = path.join(outDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const ag of bundledAgents) {
      if (ag.rawContent) {
        fs.writeFileSync(path.join(agentsDir, `${ag.name}.md`), ag.rawContent, "utf8");
      }
    }
  }
}
