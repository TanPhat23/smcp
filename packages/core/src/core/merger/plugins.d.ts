import type { PluginEntry } from "../../types/index.ts";
export declare function mergePluginsIntoFile(filePath: string, plugins: (string | PluginEntry)[], key?: string, format?: "array" | "map"): void;
export declare function installPluginFiles(targetDir: string, pluginName: string, files: Record<string, string>): void;
