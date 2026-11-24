import fs from "node:fs";
import path from "node:path";
import { expandHome } from "../../utils/paths.ts";
import { parseAgentMarkdown } from "./frontmatter.ts";
import type { UniversalAgent } from "../../types/agent.ts";

export interface ScannedAgentEntry extends UniversalAgent {
  path: string;
  rawContent: string;
}

function readAgentFileEntry(fullPath: string, fallbackName: string): ScannedAgentEntry | null {
  try {
    const rawContent = fs.readFileSync(fullPath, "utf8");
    try {
      const parsed = parseAgentMarkdown(rawContent, fullPath);
      return {
        ...parsed,
        path: fullPath,
        rawContent
      };
    } catch {
      return {
        name: fallbackName,
        description: `Custom agent ${fallbackName}`,
        mode: "subagent",
        prompt: rawContent,
        path: fullPath,
        rawContent
      };
    }
  } catch {
    return null;
  }
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
    if (item.name.startsWith(".")) continue;
    const fullPath = path.join(resolved, item.name);
    if (item.isFile() && item.name.toLowerCase().endsWith(".md")) {
      const entry = readAgentFileEntry(fullPath, item.name.replace(/\.md$/i, ""));
      if (entry) agents.push(entry);
    } else if (item.isDirectory()) {
      const nestedAgentPath = path.join(fullPath, "agent.md");
      try {
        if (fs.existsSync(nestedAgentPath) && fs.statSync(nestedAgentPath).isFile()) {
          const entry = readAgentFileEntry(nestedAgentPath, item.name);
          if (entry) agents.push(entry);
        }
      } catch {
        // Ignore unreadable nested agent directory
      }
    }
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}
