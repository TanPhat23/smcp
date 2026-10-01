import fs from "node:fs";
import path from "node:path";
import { expandHome } from "../../utils/paths.ts";
import { parseAgentMarkdown } from "./frontmatter.ts";
import type { UniversalAgent } from "../../types/agent.ts";

export interface ScannedAgentEntry extends UniversalAgent {
  path: string;
  rawContent: string;
}

export function scanAgents(agentsDirPath: string): ScannedAgentEntry[] {
  if (!agentsDirPath || typeof agentsDirPath !== "string") return [];
  const resolved = path.resolve(expandHome(agentsDirPath));
  if (!fs.existsSync(resolved)) return [];
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  let items: fs.Dirent[] = [];
  try {
    items = fs.readdirSync(resolved, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents: ScannedAgentEntry[] = [];
  for (const item of items) {
    if (!item.isFile() || !item.name.toLowerCase().endsWith(".md")) continue;
    const fullPath = path.join(resolved, item.name);
    try {
      const rawContent = fs.readFileSync(fullPath, "utf8");
      try {
        const parsed = parseAgentMarkdown(rawContent, fullPath);
        agents.push({
          ...parsed,
          path: fullPath,
          rawContent
        });
      } catch {
        const baseName = item.name.replace(/\.md$/i, "");
        agents.push({
          name: baseName,
          description: `Custom agent ${baseName}`,
          mode: "subagent",
          prompt: rawContent,
          path: fullPath,
          rawContent
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}
