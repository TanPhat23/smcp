import fs from "node:fs";
import path from "node:path";
import { getSmcpDir } from "../state/paths.ts";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import type { CacheEntry, CacheOptions } from "./types.ts";
import type { GistResponse } from "../github.ts";

export const DEFAULT_GIST_CACHE_TTL_MS = 60000;

export type GistCacheEntry = CacheEntry<GistResponse> & { gist: GistResponse };

export function getGistCacheDir(): string {
  return path.join(getSmcpDir(), "cache", "gists");
}

function resolveGistCacheFile(id: string): string {
  const cleanId = id.includes("/")
    ? id.split("/").filter(Boolean).pop()?.replace(/\.git$/, "") || id
    : id;
  const baseId = cleanId.replace(/\.json$/, "");
  return path.join(getGistCacheDir(), `${baseId}.json`);
}

export function readGistCache(
  id: string,
  options?: CacheOptions
): (CacheEntry<GistResponse> & { gist: GistResponse }) | null {
  if (options?.noCache === true) {
    return null;
  }

  try {
    const cacheFile = resolveGistCacheFile(id);
    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    const raw = fs.readFileSync(cacheFile, "utf8");
    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      typeof parsed.cachedAt !== "number" ||
      Number.isNaN(parsed.cachedAt)
    ) {
      return null;
    }

    const gistData = (parsed.data ?? parsed.gist) as GistResponse | undefined;
    if (
      !gistData ||
      typeof gistData !== "object" ||
      Array.isArray(gistData) ||
      !gistData.files ||
      typeof gistData.files !== "object" ||
      Array.isArray(gistData.files)
    ) {
      return null;
    }

    if (options?.ttlMs !== undefined) {
      const age = Date.now() - parsed.cachedAt;
      if (age >= options.ttlMs) {
        return null;
      }
    }

    const entry: CacheEntry<GistResponse> & { gist: GistResponse } = {
      etag: typeof parsed.etag === "string" ? parsed.etag : undefined,
      cachedAt: parsed.cachedAt,
      data: gistData,
      gist: gistData
    };

    return entry;
  } catch {
    return null;
  }
}

export function writeGistCache(id: string, gist: GistResponse, etag?: string): void {
  try {
    const cacheDir = getGistCacheDir();
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    }
    const cacheFile = resolveGistCacheFile(id);
    const entry = {
      etag,
      cachedAt: Date.now(),
      data: gist,
      gist
    };
    atomicWriteFileSync(cacheFile, JSON.stringify(entry, null, 2), { mode: 0o600 });
  } catch {
    // Best-effort disk cache write
  }
}

export function touchGistCache(id: string): void {
  try {
    const entry = readGistCache(id);
    if (!entry) return;
    writeGistCache(id, entry.data, entry.etag);
  } catch {
    // Best-effort
  }
}

export function clearGistCache(id?: string): void {
  try {
    const dir = getGistCacheDir();
    if (!fs.existsSync(dir)) return;

    if (id) {
      const file = resolveGistCacheFile(id);
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // ignore
        }
      }
    } else {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            fs.unlinkSync(path.join(dir, file));
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore
  }
}

export const clearGistDiskCache = clearGistCache;
