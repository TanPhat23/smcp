import fs from "node:fs";
import path from "node:path";
import { ManifestSchema, type Manifest } from "../../types/index.ts";
import { GitHubClient } from "../github.ts";
import { getAuthConfig } from "../state/index.ts";

export interface LoadedPack {
  manifest: Manifest;
  rawFiles: Record<string, string>;
  localDir?: string;
}

export async function loadPackFromSource(
  source: string,
  options?: { token?: string }
): Promise<LoadedPack> {
  if (!source || !source.trim()) {
    throw new Error("Source path or URL is required.");
  }

  const trimmedSource = source.trim();
  const token = options?.token ?? getAuthConfig().githubToken;

  let manifest: Manifest;
  const rawFiles: Record<string, string> = {};
  let localDir: string | undefined = undefined;

  // 1. Check local filesystem path first if it exists
  if (fs.existsSync(trimmedSource)) {
    const stat = fs.statSync(trimmedSource);
    let manifestPath = trimmedSource;
    if (stat.isDirectory()) {
      localDir = path.resolve(trimmedSource);
      manifestPath = path.join(trimmedSource, "smcp.json");
    } else {
      localDir = path.dirname(path.resolve(trimmedSource));
    }
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`smcp.json manifest not found at ${manifestPath}`);
    }
    const content = fs.readFileSync(manifestPath, "utf8");
    manifest = ManifestSchema.parse(JSON.parse(content));
    return { manifest, rawFiles, localDir };
  }

  // 2. Check if source is a GitHub repository (URL, github:owner/repo, or owner/repo shorthand)
  if (GitHubClient.isRepoSource(trimmedSource)) {
    const repoPack = await GitHubClient.fetchRepoPack(trimmedSource, token);
    return {
      manifest: repoPack.manifest,
      rawFiles: repoPack.rawFiles
    };
  }

  // 3. Check if source is a Gist URL or Gist ID
  const isUrl = trimmedSource.startsWith("http://") || trimmedSource.startsWith("https://");
  const isGistHexId =
    !isUrl && /^[a-fA-F0-9]{20,40}$/.test(trimmedSource);

  if (isUrl || isGistHexId) {
    const gist = await GitHubClient.fetchGist(trimmedSource, token);
    if (!gist.files || !gist.files["smcp.json"]) {
      throw new Error("Gist does not contain an smcp.json manifest file.");
    }
    manifest = ManifestSchema.parse(JSON.parse(gist.files["smcp.json"].content));
    for (const [filename, fileObj] of Object.entries(gist.files)) {
      rawFiles[filename] = fileObj.content;
    }
    return { manifest, rawFiles, localDir };
  }

  throw new Error(
    `Unsupported source: ${source}. Must be a GitHub Gist URL, GitHub repository, or local path.`
  );
}
