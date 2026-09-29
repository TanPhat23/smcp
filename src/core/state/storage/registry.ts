import { isPrototypePollutionKey } from "../../../utils/security.ts";
import { FileStorageProvider } from "./file.ts";
import type { StorageProvider } from "./types.ts";

let activeStorageProvider: StorageProvider = new FileStorageProvider();

export function validateStorageProvider(provider: unknown): asserts provider is StorageProvider {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error("Invalid StorageProvider: must be a non-null object");
  }

  const candidate = provider as Record<string, unknown>;

  if (typeof candidate.name !== "string" || !candidate.name.trim()) {
    throw new Error("Invalid StorageProvider: 'name' must be a non-empty string");
  }

  if (isPrototypePollutionKey(candidate.name)) {
    throw new Error(
      `Invalid StorageProvider name: prototype pollution key '${candidate.name}' is rejected`
    );
  }

  if (typeof candidate.getItem !== "function") {
    throw new Error(
      `StorageProvider '${candidate.name}' must implement a 'getItem(key)' method`
    );
  }

  if (typeof candidate.setItem !== "function") {
    throw new Error(
      `StorageProvider '${candidate.name}' must implement a 'setItem(key, value)' method`
    );
  }

  if (typeof candidate.removeItem !== "function") {
    throw new Error(
      `StorageProvider '${candidate.name}' must implement a 'removeItem(key)' method`
    );
  }
}

export function registerStorageProvider(provider: StorageProvider): void {
  validateStorageProvider(provider);
  activeStorageProvider = provider;
}

export function getStorageProvider(): StorageProvider {
  return activeStorageProvider;
}

export function resetStorageProvider(): void {
  activeStorageProvider = new FileStorageProvider();
}
