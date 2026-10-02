// tests/git-providers-registry.test.ts
import { describe, expect, it, beforeEach } from "bun:test";
import {
  registerGitProvider,
  unregisterGitProvider,
  resolveGitProviderForSource,
  getGitProviderById,
  getAllGitProviders,
  resetGitProviders,
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

  class MockClassProvider implements GitProvider {
    readonly id = "class-provider";
    readonly name = "Class Provider";
    readonly defaultHost = "class.git.com";

    matchesRepo(source: string): boolean {
      return source.startsWith("class:");
    }

    parseRepo(source: string): GitRepoRef | null {
      if (!this.matchesRepo(source)) return null;
      const [owner, repo] = source.slice(6).split("/");
      return { provider: this.id, host: this.defaultHost, owner, repo };
    }

    async fetchRepoPack(): Promise<any> {
      throw new Error("not implemented");
    }

    async verifyUser(): Promise<any> {
      return { username: "class-user" };
    }
  }

  beforeEach(() => {
    resetGitProviders();
  });

  it("registers and resolves a custom git provider", () => {
    registerGitProvider(dummyProvider);
    expect(getAllGitProviders().some((p) => p.id === "mock-provider")).toBe(true);
    const resolved = resolveGitProviderForSource("mock:owner/repo");
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe("mock-provider");
  });

  it("unregisters a git provider cleanly", () => {
    registerGitProvider(dummyProvider);
    expect(unregisterGitProvider("mock-provider")).toBe(true);
    expect(resolveGitProviderForSource("mock:owner/repo")).toBeNull();
  });

  it("preserves class instance prototype methods when registered", () => {
    const classInstance = new MockClassProvider();
    registerGitProvider(classInstance);

    const resolved = resolveGitProviderForSource("class:team/repo");
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe("class-provider");

    // Call prototype methods directly on registered instance
    expect(resolved?.matchesRepo("class:team/repo")).toBe(true);
    expect(resolved?.parseRepo("class:team/repo")).toEqual({
      provider: "class-provider",
      host: "class.git.com",
      owner: "team",
      repo: "repo"
    });
  });

  it("handles duplicate registration replacement and ordering with prepend", () => {
    const provider1: GitProvider = {
      ...dummyProvider,
      id: "provider-1"
    };
    const provider2: GitProvider = {
      ...dummyProvider,
      id: "provider-2"
    };

    registerGitProvider(provider1);
    registerGitProvider(provider2, true);
    expect(getAllGitProviders().map((p) => p.id)).toEqual(["provider-2", "provider-1"]);

    // Re-register provider-2 with prepend = false
    registerGitProvider(provider2, false);
    expect(getAllGitProviders().map((p) => p.id)).toEqual(["provider-1", "provider-2"]);

    // Re-register provider-2 with prepend = true
    registerGitProvider(provider2, true);
    expect(getAllGitProviders().map((p) => p.id)).toEqual(["provider-2", "provider-1"]);
  });

  it("supports case-insensitive lookup via getGitProviderById", () => {
    registerGitProvider(dummyProvider);
    expect(getGitProviderById("mock-provider")?.id).toBe("mock-provider");
    expect(getGitProviderById("MOCK-PROVIDER")?.id).toBe("mock-provider");
    expect(getGitProviderById("Mock-Provider")?.id).toBe("mock-provider");
    expect(getGitProviderById("non-existent")).toBeNull();
  });

  it("rejects invalid IDs including whitespace, special chars, and prototype pollution", () => {
    // Leading/trailing whitespace
    expect(() =>
      registerGitProvider({
        ...dummyProvider,
        id: " mock-provider "
      })
    ).toThrow("Invalid provider id");

    // Special characters
    expect(() =>
      registerGitProvider({
        ...dummyProvider,
        id: "mock@provider!"
      })
    ).toThrow("Invalid provider id");

    // Prototype pollution
    expect(() =>
      registerGitProvider({
        ...dummyProvider,
        id: "__proto__"
      })
    ).toThrow("prototype pollution");

    expect(() =>
      registerGitProvider({
        ...dummyProvider,
        id: "constructor"
      })
    ).toThrow("prototype pollution");
  });

  it("clears all providers with resetGitProviders()", () => {
    registerGitProvider(dummyProvider);
    expect(getAllGitProviders().length).toBe(1);

    resetGitProviders();
    expect(getAllGitProviders().length).toBe(0);
  });
});
