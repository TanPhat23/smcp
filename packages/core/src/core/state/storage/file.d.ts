import type { StorageProvider } from "./types.ts";
export declare class FileStorageProvider implements StorageProvider {
    readonly name = "file";
    private resolvePath;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
