import type { LoadedPack } from "./types.ts";
export type { LoadedPack, PackLoader, PackLoaderContext } from "./types.ts";
export declare function loadPackFromSource(source: string, options?: {
    token?: string;
}): Promise<LoadedPack>;
