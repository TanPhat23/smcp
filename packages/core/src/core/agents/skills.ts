import fs from "node:fs";
import path from "node:path";
import type { SkillEntry } from "../../types/index.ts";
import { hashContent } from "../../utils/crypto.ts";
import { expandHome } from "../../utils/paths.ts";
import { isItemIncludedByJsonConfig, resolveJsonConfigEntryDirs } from "./json-configs.ts";

function scanSingleSkillsDirectory(
  resolvedSkillsDir: string,
  includeOnly: readonly string[],
  exclude: readonly string[],
  seenNames: Set<string>,
  entries: SkillEntry[]
): void {
  try {
    if (!fs.existsSync(resolvedSkillsDir)) return;
    const stat = fs.statSync(resolvedSkillsDir);
    if (!stat.isDirectory()) return;
  } catch {
    return;
  }

  let items: fs.Dirent[] = [];
  try {
    items = fs.readdirSync(resolvedSkillsDir, { withFileTypes: true });
  } catch {
    return;
  }

  const sortedItems = items
    .filter((item) => !item.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const item of sortedItems) {
    const fullPath = path.join(resolvedSkillsDir, item.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (
        seenNames.has(item.name) ||
        !isItemIncludedByJsonConfig(item.name, includeOnly, exclude)
      ) {
        continue;
      }

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

      if (!skillFile) continue;

      let content = "";
      try {
        content = fs.readFileSync(skillFile, "utf8");
      } catch {
        content = "";
      }

      seenNames.add(item.name);
      entries.push({
        name: item.name,
        path: skillFile,
        contentHash: content ? hashContent(content) : undefined,
        description: `Skill in ${item.name}`
      });
    } else if (stat.isFile() && item.name.toLowerCase().endsWith(".md")) {
      const skillName = item.name.replace(/\.md$/i, "");
      if (
        seenNames.has(skillName) ||
        !isItemIncludedByJsonConfig(skillName, includeOnly, exclude)
      ) {
        continue;
      }
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        seenNames.add(skillName);
        entries.push({
          name: skillName,
          path: fullPath,
          contentHash: hashContent(content),
          description: `Skill ${item.name}`
        });
      } catch {
        // Skip unreadable file
      }
    }
  }
}

export function scanSkills(skillsDirPath: string): SkillEntry[] {
  if (!skillsDirPath) return [];
  const resolvedSkillsDir = expandHome(skillsDirPath);
  const entries: SkillEntry[] = [];
  const seenNames = new Set<string>();

  scanSingleSkillsDirectory(resolvedSkillsDir, [], [], seenNames, entries);

  const siblingSkillsJson = path.join(path.dirname(resolvedSkillsDir), "skills.json");
  for (const extraDir of resolveJsonConfigEntryDirs(siblingSkillsJson)) {
    scanSingleSkillsDirectory(
      extraDir.dirPath,
      extraDir.includeOnly,
      extraDir.exclude,
      seenNames,
      entries
    );
  }

  return entries;
}
