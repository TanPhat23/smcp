import path from "node:path";
import type { AgentToolsSchema } from "../../../types/index.ts";
import type { z } from "zod";

export type AgentToolsInput = z.infer<typeof AgentToolsSchema>;

/**
 * Normalizes an agent name into a traversal-safe stem and `.md` filename.
 */
export function sanitizeAgentFilename(rawName: unknown): { stem: string; filename: string } {
  const safeInput = typeof rawName === "string" ? rawName : "";
  const base = path.basename(safeInput.replace(/\\/g, "/")).trim().replace(/^\.+/, "");
  const stem = (base.endsWith(".md") ? base.slice(0, -3) : base) || "agent";
  return { stem, filename: `${stem}.md` };
}

/**
 * Extracts an allow-list of tools from either an array or `{ allow }` object.
 */
export function extractAllowTools(tools: AgentToolsInput | undefined): string[] | undefined {
  if (Array.isArray(tools)) {
    return tools.length > 0 ? tools : undefined;
  }
  if (tools && Array.isArray(tools.allow) && tools.allow.length > 0) {
    return tools.allow;
  }
  return undefined;
}
