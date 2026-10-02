// tests/git-providers-registry.test.ts
import { describe, expect, it, beforeEach } from "bun:test";
import {
  registerGitProvider,
  unregisterGitProvider,
  resolveGitProviderForSource,
  getAllGitProviders,
  type GitProvider,
  type GitRepoRef
} from "../packages/core/src/core/git-providers/index.ts";

describe("Git Providers Registry", () => {
  const dummyProvider: GitProvider = {
    id: "mock-provider",
    name: "Mock Provider",
    defaultHost: "mock.git.com",
    matchesRepo: (source) => source.startsWith("mock:"),
    parseRepo: (source) => {
      if (!source.startsWith("mock:")) return null;
      const [owner, repo] = source.slice(5).split("/");
      return { provider: "mock-provider", host: "mock.git.com", owner, repo };
    },
    fetchRepoPack: async () => { throw new Error("not implemented"); },
    verifyUser: async () => ({ username: "mockuser" })
  };

  beforeEach(() => {
    unregisterGitProvider("mock-provider");
  });

  it("registers and resolves a custom git provider", () => {
    registerGitProvider(dummyProvider);
    expect(getAllGitProviders().some(p => p.id === "mock-provider")).toBe(true);
    const resolved = resolveGitProviderForSource("mock:owner/repo");
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe("mock-provider");
  });

  it("unregisters a git provider cleanly", () => {
    registerGitProvider(dummyProvider);
    expect(unregisterGitProvider("mock-provider")).toBe(true);
    expect(resolveGitProviderForSource("mock:owner/repo")).toBeNull();
  });
});
