import { isPrototypePollutionKey } from "@smcp/core";
import { GistShareProvider } from "./gist.ts";
import { LocalShareProvider } from "./local.ts";
import { RepoShareProvider } from "./repo.ts";
import type { ShareProvider } from "./types.ts";

function createDefaultProviders(): ShareProvider[] {
  return [
    Object.freeze(new GistShareProvider()),
    Object.freeze(new RepoShareProvider()),
    Object.freeze(new LocalShareProvider())
  ];
}

let activeProviders: ShareProvider[] = createDefaultProviders();

function validateShareProvider(provider: unknown): asserts provider is ShareProvider {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error("Invalid ShareProvider: must be a non-null object");
  }

  const candidate = provider as Record<string, unknown>;

  if (
    typeof candidate.id !== "string" ||
    !candidate.id.trim() ||
    !/^[a-zA-Z0-9_-]+$/.test(candidate.id.trim()) ||
    candidate.id.length > 64
  ) {
    throw new Error(
      "Invalid provider id: must be 1-64 alphanumeric characters, underscores, or hyphens"
    );
  }

  if (isPrototypePollutionKey(candidate.id)) {
    throw new Error(`Invalid provider id: prototype pollution key '${candidate.id}' is rejected`);
  }

  if (typeof candidate.label !== "string" || !candidate.label.trim()) {
    throw new Error(`ShareProvider '${candidate.id}' must implement a non-empty 'label' string`);
  }

  if (typeof candidate.publish !== "function") {
    throw new Error(`ShareProvider '${candidate.id}' must implement a 'publish(context)' method`);
  }
}

/**
 * Registers a custom ShareProvider.
 */
export function registerShareProvider(provider: ShareProvider, prepend = false): void {
  validateShareProvider(provider);
  const safeProvider = Object.isFrozen(provider) ? provider : Object.freeze({ ...provider });
  activeProviders = activeProviders.filter((p) => p.id !== safeProvider.id);

  if (prepend) {
    activeProviders.unshift(safeProvider);
  } else {
    activeProviders.push(safeProvider);
  }
}

/**
 * Unregisters a ShareProvider by ID.
 */
export function unregisterShareProvider(id: string): boolean {
  if (!id || typeof id !== "string" || isPrototypePollutionKey(id)) {
    return false;
  }
  const prevLength = activeProviders.length;
  activeProviders = activeProviders.filter((p) => p.id !== id.trim());
  return activeProviders.length < prevLength;
}

/**
 * Resolves a registered ShareProvider by ID.
 */
export function getShareProvider(id?: string): ShareProvider | null {
  if (!id || typeof id !== "string" || isPrototypePollutionKey(id)) {
    return null;
  }
  const found = activeProviders.find((p) => p.id === id.trim().toLowerCase());
  return found || null;
}

/**
 * Returns a defensive read-only snapshot of all active ShareProviders.
 */
export function getAllShareProviders(): readonly ShareProvider[] {
  return Object.freeze([...activeProviders]);
}

/**
 * Resets all active ShareProviders to default built-ins.
 */
export function resetShareProviders(): void {
  activeProviders = createDefaultProviders();
}
