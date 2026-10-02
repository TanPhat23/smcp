import { registerGitProvider } from "../registry.ts";
import { GitLabGitProvider } from "./provider.ts";

export * from "./types.ts";
export * from "./client.ts";
export * from "./snippet.ts";
export * from "./repo.ts";
export * from "./provider.ts";

export const defaultGitLabGitProvider = new GitLabGitProvider();
registerGitProvider(defaultGitLabGitProvider, false);
