import type { StorageProvider } from "./types.ts";
export declare function validateStorageProvider(provider: unknown): asserts provider is StorageProvider;
export declare function registerStorageProvider(provider: StorageProvider): void;
export declare function getStorageProvider(): StorageProvider;
export declare function resetStorageProvider(): void;
