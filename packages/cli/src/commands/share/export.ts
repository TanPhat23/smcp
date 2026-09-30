import fs from "node:fs";
import path from "node:path";
import {
  installPluginFiles,
  installSkillFiles,
  type Manifest,
  type PluginEntry,
  type SkillEntry
} from "@tanphat/core";

export function exportPackLocally(
  manifest: Manifest,
  bundledSkills: SkillEntry[],
  outputDir: string,
  bundledPlugins?: PluginEntry[]
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
}
