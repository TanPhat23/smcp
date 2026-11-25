import type { Manifest, PluginObjectEntry } from "../../types/index.ts";
import { isIgnoredPath, pLimit } from "../../utils/fs.ts";

export interface RepoBlobDescriptor {
  path: string;
  sha?: string;
}

/**
 * Selects repository blobs that should be downloaded into rawFiles,
 * skipping ignored runtime artifacts (e.g. .in_use, node_modules) and
 * skill/plugin files already embedded inline inside `smcp.json`.
 */
export function selectRelevantRepoBlobs<T extends RepoBlobDescriptor>(
  blobs: readonly T[],
  manifest: Manifest,
  prefix = ""
): T[] {
  const inlineSkills = new Set(
    (manifest.skills || [])
      .filter((sk) => sk.files && Object.keys(sk.files).length > 0)
      .map((sk) => sk.name)
  );
  const inlinePlugins = new Set(
    (manifest.plugins || [])
      .filter(
        (pl): pl is PluginObjectEntry =>
          typeof pl === "object" && Boolean(pl.files && Object.keys(pl.files).length > 0)
      )
      .map((pl) => pl.name)
  );

  return blobs.filter((item) => {
    if (prefix && !item.path.startsWith(prefix)) {
      return false;
    }
    const rel = (prefix ? item.path.slice(prefix.length) : item.path).replaceAll("\\", "/");
    if (!rel || isIgnoredPath(rel)) {
      return false;
    }

    if (rel.startsWith("skills/")) {
      const skillName = rel.split("/")[1];
      if (skillName && inlineSkills.has(skillName)) {
        return false;
      }
      return true;
    }

    if (rel.startsWith("plugins/")) {
      const pluginName = rel.split("/")[1];
      if (pluginName && inlinePlugins.has(pluginName)) {
        return false;
      }
      return true;
    }

    if (rel === "mcp/mcp.json" || rel === "mcp.json") {
      return !manifest.mcpServers || Object.keys(manifest.mcpServers).length === 0;
    }

    if (rel.startsWith("rules/")) {
      const hasInlineRules =
        (manifest.rules || []).length > 0 &&
        (manifest.rules || []).every((r) => typeof r.content === "string" && r.content.length > 0);
      return !hasInlineRules;
    }

    if (rel === "hooks/hooks.json" || rel === "hooks.json") {
      return !manifest.hooks || Object.keys(manifest.hooks).length === 0;
    }

    return rel.startsWith("agents/") || rel.endsWith(".md") || rel.endsWith(".json");
  });
}

/**
 * Stores a downloaded repository blob into `rawFiles` under both its relative path
 * and the flattened Gist-compatible alias for skills/plugins.
 */
export function assignRepoRawFile(
  rawFiles: Record<string, string>,
  relPath: string,
  content: string
): void {
  const normalizedRel = relPath.replaceAll("\\", "/");
  rawFiles[normalizedRel] = content;

  if (normalizedRel.startsWith("skills/")) {
    const parts = normalizedRel.split("/");
    if (parts.length >= 3) {
      const skillName = parts[1];
      const filePart = parts.slice(2).join("_");
      rawFiles[`skills_${skillName}_${filePart}`] = content;
    }
  } else if (normalizedRel.startsWith("plugins/")) {
    const parts = normalizedRel.split("/");
    if (parts.length >= 3) {
      const pluginName = parts[1];
      const filePart = parts.slice(2).join("_");
      rawFiles[`plugins_${pluginName}_${filePart}`] = content;
    }
  }
}

/**
 * Fetches all relevant repository blobs with bounded concurrency, ignoring
 * non-fatal errors on individual auxiliary files.
 */
export async function fetchRelevantRepoBlobs<T extends RepoBlobDescriptor>(
  blobs: readonly T[],
  manifest: Manifest,
  prefix: string,
  rawFiles: Record<string, string>,
  fetcher: (blob: T) => Promise<string>,
  concurrency = 10
): Promise<void> {
  const relevantBlobs = selectRelevantRepoBlobs(blobs, manifest, prefix);
  if (relevantBlobs.length === 0) return;

  const limit = pLimit(concurrency);
  await Promise.all(
    relevantBlobs.map((blob) =>
      limit(async () => {
        try {
          const content = await fetcher(blob);
          const relPath = prefix ? blob.path.slice(prefix.length) : blob.path;
          assignRepoRawFile(rawFiles, relPath, content);
        } catch {
          // Ignore non-fatal auxiliary file errors
        }
      })
    )
  );
}
