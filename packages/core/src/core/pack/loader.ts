import { getAllPackLoaders } from "./registry.ts";
import type { LoadedPack, PackLoaderContext } from "./types.ts";

export type { LoadedPack, PackLoader, PackLoaderContext } from "./types.ts";

export async function loadPackFromSource(
  source: string,
  options?: { token?: string; noCache?: boolean; fetchAllTruncated?: boolean }
): Promise<LoadedPack> {
  if (!source || !source.trim()) {
    throw new Error("Source path or URL is required.");
  }

  const trimmedSource = source.trim();
  // Only an explicitly supplied token is forwarded as-is. Otherwise each loader resolves the
  // stored token for the provider that actually matched the source, so a GitHub token is
  // never sent to GitLab/Gitea (or any other) host.
  const token = options?.token;
  const context: PackLoaderContext = {
    source: trimmedSource,
    token,
    noCache: options?.noCache,
    fetchAllTruncated: options?.fetchAllTruncated
  };

  const loaders = getAllPackLoaders();
  for (const loader of loaders) {
    let matched = false;
    try {
      matched = await loader.matches(context);
    } catch {
      continue;
    }

    if (matched) {
      return await loader.load(context);
    }
  }

  throw new Error(
    `Unsupported source: ${source}. Must be a GitHub Gist URL, GitHub repository, or local path.`
  );
}
