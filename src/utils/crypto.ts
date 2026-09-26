import { createHash } from "node:crypto";

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function sortObjectDeep(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectDeep);
  }
  const sortedEntries = Object.entries(obj)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => [key, sortObjectDeep(value)]);
  return Object.fromEntries(sortedEntries);
}

export function hashObject(obj: unknown): string {
  const canonical = JSON.stringify(sortObjectDeep(obj)) ?? "";
  return hashContent(canonical);
}
