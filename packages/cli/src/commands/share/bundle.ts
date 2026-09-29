import fs from "node:fs";
import path from "node:path";
import {
  collectDirectoryFilesAsync,
  hashObject,
  isStrictlyInside,
  type PluginEntry,
  type PluginObjectEntry,
  type SkillEntry
} from "@smcp/core";

export function bundleSkillFiles(skills: SkillEntry[]): {
  bundledSkills: SkillEntry[];
  gistFiles: Record<string, { content: string }>;
} {
  const bundledSkills: SkillEntry[] = [];
  const gistFiles: Record<string, { content: string }> = {};

  for (const sk of skills) {
    const skillFiles: Record<string, string> = {};
    const resolvedPath = path.resolve(sk.path);

    let skillDir: string | null = null;
    if (fs.existsSync(resolvedPath)) {
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        skillDir = resolvedPath;
      } else if (stat.isFile()) {
        const parentDir = path.dirname(resolvedPath);
        if (
          path.basename(parentDir) === sk.name &&
          fs.existsSync(parentDir) &&
          fs.statSync(parentDir).isDirectory()
        ) {
          skillDir = parentDir;
        }
      }
    }

    if (skillDir) {
      const canonicalSkillDir = fs.existsSync(skillDir) ? fs.realpathSync(skillDir) : skillDir;
      const allEntries = fs.readdirSync(skillDir, { recursive: true });
      for (const entry of allEntries) {
        const full = path.join(skillDir, entry as string);
        if (fs.existsSync(full)) {
          const lstat = fs.lstatSync(full);
          if (lstat.isSymbolicLink()) {
            try {
              const realFull = fs.realpathSync(full);
              if (!isStrictlyInside(canonicalSkillDir, realFull)) {
                continue; // Skip symlinks pointing outside the skill directory
              }
            } catch {
              continue;
            }
          }

          if (fs.statSync(full).isFile()) {
            const rel = path.relative(skillDir, full).replaceAll("\\", "/");
            const segments = rel.split("/");
            if (segments.some((seg) => seg.startsWith("."))) {
              continue;
            }
            const content = fs.readFileSync(full, "utf8");
            skillFiles[rel] = content;
            gistFiles[`skills_${sk.name}_${rel.replaceAll("/", "_")}`] = { content };
          }
        }
      }
    }

    if (Object.keys(skillFiles).length === 0) {
      const content =
        fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()
          ? fs.readFileSync(resolvedPath, "utf8")
          : `# ${sk.name}\n\n${sk.description || ""}\n`;
      skillFiles["SKILL.md"] = content;
      gistFiles[`skills_${sk.name}_SKILL.md`] = { content };
    }

    bundledSkills.push({
      name: sk.name,
      path: `skills/${sk.name}/SKILL.md`,
      description: sk.description,
      contentHash: hashObject(skillFiles),
      files: skillFiles
    });
  }

  return { bundledSkills, gistFiles };
}

export async function bundlePluginFiles(plugins: PluginEntry[]): Promise<{
  bundledPlugins: PluginObjectEntry[];
  gistFiles: Record<string, { content: string }>;
}> {
  const bundledPlugins: PluginObjectEntry[] = [];
  const gistFiles: Record<string, { content: string }> = {};

  for (const pl of plugins) {
    const pName = typeof pl === "string" ? pl : pl.name;
    const targetAgent = typeof pl === "object" ? pl.targetAgent : undefined;
    const desc = typeof pl === "object" ? pl.description : undefined;
    const pPath = typeof pl === "object" ? pl.path : undefined;

    let pluginFiles: Record<string, string> = {};
    if (typeof pl === "object" && pl.files && Object.keys(pl.files).length > 0) {
      pluginFiles = { ...pl.files };
    } else if (pPath && fs.existsSync(pPath)) {
      pluginFiles = await collectDirectoryFilesAsync(pPath);
    }

    for (const [relPath, content] of Object.entries(pluginFiles)) {
      const sanitizedName = pName.replace(/[^a-zA-Z0-9_-]/g, "_");
      gistFiles[`plugins_${sanitizedName}_${relPath.replaceAll("/", "_")}`] = { content };
    }

    bundledPlugins.push({
      name: pName,
      targetAgent,
      description: desc,
      path: pPath ? `plugins/${pName}` : undefined,
      files: Object.keys(pluginFiles).length > 0 ? pluginFiles : undefined
    });
  }

  return { bundledPlugins, gistFiles };
}
