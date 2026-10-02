import { loadPackFromSource } from "./loader.ts";
import type { InstalledPackRecord } from "../../types/index.ts";

export type PackUpdateStatus = "up-to-date" | "outdated" | "deleted" | "error";

export interface PackUpdateCheckResult {
  name: string;
  source: string;
  installedVersion: string;
  latestVersion?: string;
  status: PackUpdateStatus;
  error?: string;
}

/**
 * Compares two semantic version strings (e.g. "1.0.0" vs "1.1.0").
 * Returns >0 if v1 > v2, <0 if v1 < v2, 0 if v1 === v2.
 */
export function compareSemver(v1: string, v2: string): number {
  if (v1 === v2) return 0;
  const parseParts = (v: string) =>
    v
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((part) => {
        const num = parseInt(part, 10);
        return Number.isNaN(num) ? 0 : num;
      });

  const p1 = parseParts(v1);
  const p2 = parseParts(v2);

  const maxLen = Math.max(p1.length, p2.length);
  for (let i = 0; i < maxLen; i++) {
    const n1 = p1[i] ?? 0;
    const n2 = p2[i] ?? 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }

  return v1.localeCompare(v2);
}

export async function checkPackUpdateStatus(
  record: InstalledPackRecord,
  options?: { token?: string; noCache?: boolean }
): Promise<PackUpdateCheckResult> {
  const result: PackUpdateCheckResult = {
    name: record.name,
    source: record.source,
    installedVersion: record.version,
    status: "up-to-date"
  };

  try {
    const loaded = await loadPackFromSource(record.source, { ...options, noCache: true });
    const remoteVersion = loaded.manifest.version || "0.0.0";
    result.latestVersion = remoteVersion;

    if (compareSemver(remoteVersion, record.version) > 0) {
      result.status = "outdated";
    } else {
      result.status = "up-to-date";
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.error = msg;

    const isNotFound =
      msg.includes("404") ||
      msg.includes("Not Found") ||
      msg.includes("not found") ||
      msg.includes("Unsupported source") ||
      msg.includes("does not contain an smcp.json");

    if (isNotFound) {
      result.status = "deleted";
    } else {
      result.status = "error";
    }
  }

  return result;
}
