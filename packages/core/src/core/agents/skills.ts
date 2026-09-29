import fs from "node:fs";
import path from "node:path";
import type { SkillEntry } from "../../types/index.ts";
import { hashContent } from "../../utils/crypto.ts";
import { expandHome } from "../../utils/paths.ts";

export function scanSkills(skillsDirPath: string): SkillEntry[] {
  if (!skillsDirPath) return [];
  const resolvedSkillsDir = expandHome(skillsDirPath);
  try {
    if (!fs.existsSync(resolvedSkillsDir)) return [];
    const stat = fs.statSync(resolvedSkillsDir);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  let items: fs.Dirent[] = [];
  try {
    items = fs.readdirSync(resolvedSkillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: SkillEntry[] = [];
  const sortedItems = items
    .filter((item) => !item.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const item of sortedItems) {
    const fullPath = path.join(resolvedSkillsDir, item.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      // Broken symlink or unreadable - skip
      continue;
    }

    if (stat.isDirectory()) {
      let skillFile: string | null = null;
      const candidates = ["SKILL.md", "skill.md", "README.md", "readme.md"];
      for (const candidate of candidates) {
        const candPath = path.join(fullPath, candidate);
        try {
          const candStat = fs.statSync(candPath);
          if (candStat.isFile()) {
            skillFile = candPath;
            break;
          }
        } catch {
          // File does not exist or unreadable
        }
      }

      if (!skillFile) {
        try {
          const subEntries = fs.readdirSync(fullPath);
          for (const candidate of ["skill.md", "readme.md"]) {
            const match = subEntries.find((e) => e.toLowerCase() === candidate);
            if (match) {
              const candPath = path.join(fullPath, match);
              const candStat = fs.statSync(candPath);
              if (candStat.isFile()) {
                skillFile = candPath;
                break;
              }
            }
          }
        } catch {
          // Directory unreadable
        }
      }

      if (!skillFile) {
        // If a directory does NOT contain any valid skill file, do NOT push it
        continue;
      }

      let content = "";
      try {
        content = fs.readFileSync(skillFile, "utf8");
      } catch {
        content = "";
      }

      entries.push({
        name: item.name,
        path: skillFile,
        contentHash: content ? hashContent(content) : undefined,
        description: `Skill in ${item.name}`
      });
    } else if (stat.isFile() && item.name.toLowerCase().endsWith(".md")) {
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        entries.push({
          name: item.name.replace(/\.md$/i, ""),
          path: fullPath,
          contentHash: hashContent(content),
          description: `Skill ${item.name}`
        });
      } catch {
        // Skip unreadable file
      }
    }
  }

  return entries;
}
