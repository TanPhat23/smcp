import type { LoadedPack, PackLoader, PackLoaderContext } from "./types.ts";
export declare class LocalPackLoader implements PackLoader {
    readonly name = "local";
    matches(context: PackLoaderContext): boolean;
    load(context: PackLoaderContext): Promise<LoadedPack>;
}
export declare class GitHubRepoPackLoader implements PackLoader {
    readonly name = "github-repo";
    matches(context: PackLoaderContext): boolean;
    load(context: PackLoaderContext): Promise<LoadedPack>;
}
export declare class GistPackLoader implements PackLoader {
    readonly name = "github-gist";
    matches(context: PackLoaderContext): boolean;
    load(context: PackLoaderContext): Promise<LoadedPack>;
}
/**
 * Registers a custom PackLoader. Custom loaders take precedence over defaults by default.
 */
export declare function registerPackLoader(loader: PackLoader, prepend?: boolean): void;
/**
 * Unregisters a PackLoader by name.
 */
export declare function unregisterPackLoader(name: string): boolean;
/**
 * Returns a defensive read-only list of active PackLoaders.
 */
export declare function getAllPackLoaders(): readonly PackLoader[];
/**
 * Retrieves an active PackLoader by name.
 */
export declare function getPackLoader(name: string): PackLoader | undefined;
/**
 * Resets all active PackLoaders to default built-ins.
 */
export declare function resetPackLoaders(): void;
