import { isPrototypePollutionKey } from "../../utils/security.ts";
import type { GitProvider } from "./types.ts";

let activeProviders: GitProvider[] = [];

function validateGitProvider(provider: unknown): asserts provider is GitProvider {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error("Invalid GitProvider: must be a non-null object");
  }

  const candidate = provider as Record<string, unknown>;

  if (
    typeof candidate.id !== "string" ||
    !candidate.id ||
    !/^[a-zA-Z0-9_-]+$/.test(candidate.id) ||
    candidate.id.length > 64
  ) {
    throw new Error(
      "Invalid provider id: must be 1-64 alphanumeric characters, underscores, or hyphens"
    );
  }

  if (isPrototypePollutionKey(candidate.id.trim().toLowerCase())) {
    throw new Error(`Invalid provider id: prototype pollution key '${candidate.id}' is rejected`);
  }

  if (typeof candidate.name !== "string" || !candidate.name.trim()) {
    throw new Error(`GitProvider '${candidate.id}' must implement a non-empty 'name' string`);
  }

  if (typeof candidate.defaultHost !== "string" || !candidate.defaultHost.trim()) {
    throw new Error(`GitProvider '${candidate.id}' must implement a non-empty 'defaultHost' string`);
  }

  if (typeof candidate.matchesRepo !== "function") {
    throw new Error(`GitProvider '${candidate.id}' must implement a 'matchesRepo(source)' method`);
  }

  if (typeof candidate.parseRepo !== "function") {
    throw new Error(`GitProvider '${candidate.id}' must implement a 'parseRepo(source)' method`);
  }

  if (typeof candidate.fetchRepoPack !== "function") {
    throw new Error(`GitProvider '${candidate.id}' must implement a 'fetchRepoPack(ref, options)' method`);
  }

  if (typeof candidate.verifyUser !== "function") {
    throw new Error(`GitProvider '${candidate.id}' must implement a 'verifyUser(token, host)' method`);
  }
}

/**
 * Registers a GitProvider in the registry. Custom providers take precedence by default.
 */
export function registerGitProvider(provider: GitProvider, prepend = true): void {
  validateGitProvider(provider);
  const safeProvider: GitProvider = Object.isFrozen(provider)
    ? provider
    : Object.freeze(
        Object.assign(Object.create(Object.getPrototypeOf(provider)), provider)
      );
  activeProviders = activeProviders.filter(
    (p) => p.id.toLowerCase() !== safeProvider.id.toLowerCase()
  );

  if (prepend) {
    activeProviders.unshift(safeProvider);
  } else {
    activeProviders.push(safeProvider);
  }
}

/**
 * Unregisters a GitProvider by id.
 */
export function unregisterGitProvider(id: string): boolean {
  if (!id || typeof id !== "string" || isPrototypePollutionKey(id)) {
    return false;
  }
  const cleanId = id.trim().toLowerCase();
  const prevLength = activeProviders.length;
  activeProviders = activeProviders.filter((p) => p.id.toLowerCase() !== cleanId);
  return activeProviders.length < prevLength;
}

/**
 * Resolves a GitProvider for a given remote source (repository URL, shorthand, or snippet).
 */
export function resolveGitProviderForSource(source: string): GitProvider | null {
  if (!source || typeof source !== "string") {
    return null;
  }
  const trimmed = source.trim();
  for (const provider of activeProviders) {
    try {
      if (provider.matchesRepo(trimmed)) {
        return provider;
      }
      if (typeof provider.matchesSnippet === "function" && provider.matchesSnippet(trimmed)) {
        return provider;
      }
    } catch {
      // Ignore provider evaluation errors and continue resolution
    }
  }
  return null;
}

/**
 * Resolves a registered GitProvider by id.
 */
export function getGitProviderById(id: string): GitProvider | null {
  if (!id || typeof id !== "string" || isPrototypePollutionKey(id)) {
    return null;
  }
  const cleanId = id.trim().toLowerCase();
  const found = activeProviders.find((p) => p.id.toLowerCase() === cleanId);
  return found || null;
}

/**
 * Returns a defensive read-only snapshot of all registered GitProviders.
 */
export function getAllGitProviders(): readonly GitProvider[] {
  return Object.freeze([...activeProviders]);
}

/**
 * Resets the active providers list.
 */
export function resetGitProviders(): void {
  activeProviders = [];
}
