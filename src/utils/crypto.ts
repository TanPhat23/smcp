import { createHash } from "node:crypto";

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function sortObjectDeep(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectDeep);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortObjectDeep((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function hashObject(obj: unknown): string {
  const canonical = JSON.stringify(sortObjectDeep(obj));
  return hashContent(canonical);
}
