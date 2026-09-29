import type { Manifest } from "../../types/index.ts";

export interface LoadedPack {
  manifest: Manifest;
  rawFiles: Record<string, string>;
  localDir?: string;
}

export interface PackLoaderContext {
  source: string;
  token?: string;
}

export interface PackLoader {
  readonly name: string;
  matches(context: PackLoaderContext): boolean | Promise<boolean>;
  load(context: PackLoaderContext): Promise<LoadedPack>;
}
