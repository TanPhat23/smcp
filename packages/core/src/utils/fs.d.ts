export interface AtomicWriteOptions {
    mode?: number;
}
export declare const DEFAULT_IGNORE_PATTERNS: string[];
/**
 * High-performance path ignore filter using partitioned Set lookups.
 *
 * Checks file paths against ignored extensions (O(1)), exact directory/file segments (O(1)),
 * and multi-segment prefix paths. Avoids O(segments * patterns) quadratic nested loops and allocations.
 *
 * @param relPath - Relative file path to inspect.
 * @param customIgnores - Optional additional ignore rules.
 * @returns True if the path should be ignored.
 */
export declare function isIgnoredPath(relPath: string, customIgnores?: string[]): boolean;
export declare function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T>;
export interface CollectFilesOptions {
    maxFileSize?: number;
    customIgnores?: string[];
    concurrency?: number;
}
export declare function collectDirectoryFilesAsync(rootDir: string, options?: CollectFilesOptions): Promise<Record<string, string>>;
export declare function atomicWriteFileAsync(filePath: string, content: string, options?: AtomicWriteOptions): Promise<void>;
export declare function atomicWriteFileSync(filePath: string, content: string, options?: AtomicWriteOptions): void;
