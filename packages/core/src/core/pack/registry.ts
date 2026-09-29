import fs from "node:fs";
import path from "node:path";
import { ManifestSchema } from "../../types/index.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { GitHubClient } from "../github.ts";
import type { LoadedPack, PackLoader, PackLoaderContext } from "./types.ts";

export class LocalPackLoader implements PackLoader {
  readonly name = "local";

  matches(context: PackLoaderContext): boolean {
    const trimmed = context.source.trim();
    return fs.existsSync(trimmed);
  }

  async load(context: PackLoaderContext): Promise<LoadedPack> {
    const trimmed = context.source.trim();
    const stat = fs.statSync(trimmed);
    let localDir: string;
    let manifestPath = trimmed;

    if (stat.isDirectory()) {
      localDir = path.resolve(trimmed);
      manifestPath = path.join(trimmed, "smcp.json");
    } else {
      localDir = path.dirname(path.resolve(trimmed));
    }

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`smcp.json manifest not found at ${manifestPath}`);
    }

    const content = fs.readFileSync(manifestPath, "utf8");
    const manifest = ManifestSchema.parse(JSON.parse(content));
    return { manifest, rawFiles: {}, localDir };
  }
}

export class GitHubRepoPackLoader implements PackLoader {
  readonly name = "github-repo";

  matches(context: PackLoaderContext): boolean {
    return GitHubClient.isRepoSource(context.source.trim());
  }

  async load(context: PackLoaderContext): Promise<LoadedPack> {
    const repoPack = await GitHubClient.fetchRepoPack(context.source.trim(), context.token);
    return {
      manifest: repoPack.manifest,
      rawFiles: repoPack.rawFiles
    };
  }
}

export class GistPackLoader implements PackLoader {
  readonly name = "github-gist";

  matches(context: PackLoaderContext): boolean {
    const trimmed = context.source.trim();
    const isUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://");
    const isGistHexId = !isUrl && /^[a-fA-F0-9]{20,40}$/.test(trimmed);
    return isUrl || isGistHexId;
  }

  async load(context: PackLoaderContext): Promise<LoadedPack> {
    const trimmed = context.source.trim();
    const gist = await GitHubClient.fetchGist(trimmed, context.token);
    if (!gist.files || !gist.files["smcp.json"]) {
      throw new Error("Gist does not contain an smcp.json manifest file.");
    }
    const manifest = ManifestSchema.parse(JSON.parse(gist.files["smcp.json"].content));
    const rawFiles: Record<string, string> = {};
    for (const [filename, fileObj] of Object.entries(gist.files)) {
      rawFiles[filename] = fileObj.content;
    }
    return { manifest, rawFiles };
  }
}

function createDefaultLoaders(): PackLoader[] {
  return [
    Object.freeze(new LocalPackLoader()),
    Object.freeze(new GitHubRepoPackLoader()),
    Object.freeze(new GistPackLoader())
  ];
}

let activeLoaders: PackLoader[] = createDefaultLoaders();

function validatePackLoader(loader: unknown): asserts loader is PackLoader {
  if (!loader || typeof loader !== "object" || Array.isArray(loader)) {
    throw new Error("Invalid PackLoader: must be a non-null object");
  }

  const candidate = loader as Record<string, unknown>;

  if (
    typeof candidate.name !== "string" ||
    !candidate.name.trim() ||
    !/^[a-zA-Z0-9_-]+$/.test(candidate.name.trim()) ||
    candidate.name.length > 64
  ) {
    throw new Error(
      "Invalid loader name: must be 1-64 alphanumeric characters, underscores, or hyphens"
    );
  }

  if (isPrototypePollutionKey(candidate.name)) {
    throw new Error(`Invalid loader name: prototype pollution key '${candidate.name}' is rejected`);
  }

  if (typeof candidate.matches !== "function") {
    throw new Error(`PackLoader '${candidate.name}' must implement a 'matches(context)' method`);
  }

  if (typeof candidate.load !== "function") {
    throw new Error(`PackLoader '${candidate.name}' must implement a 'load(context)' method`);
  }
}

/**
 * Registers a custom PackLoader. Custom loaders take precedence over defaults by default.
 */
export function registerPackLoader(loader: PackLoader, prepend = true): void {
  validatePackLoader(loader);
  const safeLoader = Object.isFrozen(loader) ? loader : Object.freeze({ ...loader });
  activeLoaders = activeLoaders.filter((l) => l.name !== safeLoader.name);

  if (prepend) {
    activeLoaders.unshift(safeLoader);
  } else {
    activeLoaders.push(safeLoader);
  }
}

/**
 * Unregisters a PackLoader by name.
 */
export function unregisterPackLoader(name: string): boolean {
  if (!name || typeof name !== "string" || isPrototypePollutionKey(name)) {
    return false;
  }
  const prevLength = activeLoaders.length;
  activeLoaders = activeLoaders.filter((l) => l.name !== name.trim());
  return activeLoaders.length < prevLength;
}

/**
 * Returns a defensive read-only list of active PackLoaders.
 */
export function getAllPackLoaders(): readonly PackLoader[] {
  return Object.freeze([...activeLoaders]);
}

/**
 * Retrieves an active PackLoader by name.
 */
export function getPackLoader(name: string): PackLoader | undefined {
  if (!name || typeof name !== "string" || isPrototypePollutionKey(name)) {
    return undefined;
  }
  return activeLoaders.find((l) => l.name === name.trim());
}

/**
 * Resets all active PackLoaders to default built-ins.
 */
export function resetPackLoaders(): void {
  activeLoaders = createDefaultLoaders();
}
