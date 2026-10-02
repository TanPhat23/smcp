import fs from "node:fs";
import path from "node:path";
import { ManifestSchema } from "../../types/index.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { resolveGitProviderForSource } from "../git-providers/index.ts";
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

export class GitRepoPackLoader implements PackLoader {
  readonly name: string = "git-repo";

  matches(context: PackLoaderContext): boolean {
    const trimmed = context.source.trim();
    const provider = resolveGitProviderForSource(trimmed);
    if (!provider) return false;
    return provider.matchesRepo(trimmed) && provider.parseRepo(trimmed) !== null;
  }

  async load(context: PackLoaderContext): Promise<LoadedPack> {
    const trimmed = context.source.trim();
    const provider = resolveGitProviderForSource(trimmed);
    if (!provider) {
      throw new Error(`No git provider found for source: ${trimmed}`);
    }
    const parsedRepo = provider.parseRepo(trimmed);
    if (!parsedRepo) {
      throw new Error(`Failed to parse repository source with provider '${provider.id}': ${trimmed}`);
    }
    const repoPack = await provider.fetchRepoPack(parsedRepo, {
      token: context.token,
      noCache: context.noCache
    });
    return {
      manifest: repoPack.manifest,
      rawFiles: repoPack.rawFiles
    };
  }
}

export class GitHubRepoPackLoader extends GitRepoPackLoader {
  override readonly name = "github-repo";
}

export class SnippetPackLoader implements PackLoader {
  readonly name: string = "git-snippet";

  matches(context: PackLoaderContext): boolean {
    const trimmed = context.source.trim();
    const provider = resolveGitProviderForSource(trimmed);
    if (provider && typeof provider.matchesSnippet === "function" && provider.matchesSnippet(trimmed)) {
      return true;
    }
    const isUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://");
    const isGistHexId = !isUrl && /^[a-fA-F0-9]{20,40}$/.test(trimmed);
    return isUrl || isGistHexId;
  }

  async load(context: PackLoaderContext): Promise<LoadedPack> {
    const trimmed = context.source.trim();
    const provider = resolveGitProviderForSource(trimmed);
    if (provider && provider.id !== "github" && typeof provider.fetchSnippetPack === "function") {
      const parsedSnippet = provider.parseSnippet ? provider.parseSnippet(trimmed) : null;
      if (parsedSnippet) {
        const snippetPack = await provider.fetchSnippetPack(parsedSnippet, {
          token: context.token,
          noCache: context.noCache,
          fetchAllTruncated: context.fetchAllTruncated
        });
        return {
          manifest: snippetPack.manifest,
          rawFiles: snippetPack.rawFiles
        };
      }
    }

    const gist = await GitHubClient.fetchGist(trimmed, context.token, {
      noCache: context.noCache,
      fetchAllTruncated: context.fetchAllTruncated
    });
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

export class GistPackLoader extends SnippetPackLoader {
  override readonly name = "github-gist";
}

function createDefaultLoaders(): PackLoader[] {
  return [
    Object.freeze(new LocalPackLoader()),
    Object.freeze(new GitRepoPackLoader()),
    Object.freeze(new SnippetPackLoader())
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
  const cleanName = name.trim();
  const prevLength = activeLoaders.length;
  activeLoaders = activeLoaders.filter(
    (l) =>
      l.name !== cleanName &&
      !(cleanName === "github-repo" && l.name === "git-repo") &&
      !(cleanName === "github-gist" && l.name === "git-snippet")
  );
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
  const cleanName = name.trim();
  const found = activeLoaders.find((l) => l.name === cleanName);
  if (found) return found;
  if (cleanName === "github-repo") {
    return activeLoaders.find((l) => l.name === "git-repo");
  }
  if (cleanName === "github-gist") {
    return activeLoaders.find((l) => l.name === "git-snippet");
  }
  return undefined;
}

/**
 * Resets all active PackLoaders to default built-ins.
 */
export function resetPackLoaders(): void {
  activeLoaders = createDefaultLoaders();
}
