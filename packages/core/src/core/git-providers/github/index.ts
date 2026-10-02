import { registerGitProvider } from "../registry.ts";
import { GitHubGitProvider } from "./provider.ts";

export * from "./types.ts";
export * from "./errors.ts";
export * from "./client.ts";
export * from "./gist.ts";
export * from "./repo.ts";
export * from "./provider.ts";

export const defaultGitHubGitProvider = new GitHubGitProvider();
registerGitProvider(defaultGitHubGitProvider, false);
