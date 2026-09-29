import { z } from "zod";
import { isPrototypePollutionKey } from "../utils/security.ts";

function isSafePluginName(val: string): boolean {
  if (typeof val !== "string" || !val.trim()) return false;
  const trimmed = val.trim();
  if (
    trimmed.includes("..") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    isPrototypePollutionKey(trimmed)
  ) {
    return false;
  }
  return true;
}

export const PluginObjectEntrySchema = z.object({
  name: z.string().refine(isSafePluginName, {
    message: "Plugin name must not contain directory traversal or prototype pollution keys"
  }),
  targetAgent: z.string().optional(),
  description: z.string().optional(),
  path: z.string().optional(),
  files: z.record(z.string(), z.string()).optional()
});

export const PluginEntrySchema = z.union([
  z.string().refine(isSafePluginName, {
    message: "Plugin entry must not contain directory traversal or prototype pollution keys"
  }),
  PluginObjectEntrySchema
]);

export type PluginObjectEntry = z.infer<typeof PluginObjectEntrySchema>;
export type PluginEntry = z.infer<typeof PluginEntrySchema>;
