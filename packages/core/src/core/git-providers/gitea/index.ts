import { registerGitProvider } from "../registry.ts";
import { GiteaGitProvider } from "./provider.ts";

export * from "./types.ts";
export * from "./client.ts";
export * from "./repo.ts";
export * from "./provider.ts";

export const defaultGiteaGitProvider = new GiteaGitProvider();
registerGitProvider(defaultGiteaGitProvider, false);
