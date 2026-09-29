import { describe, expect, it } from "bun:test";
import * as Core from "../src/core/index.ts";
import * as Library from "../src/index.ts";

describe("Programmatic Library SDK Entrypoint (src/index.ts & src/core/index.ts)", () => {
  describe("src/index.ts public exports", () => {
    it("exports all core type schemas", () => {
      expect(Library.ManifestSchema).toBeDefined();
      expect(Library.AgentProfileSchema).toBeDefined();
      expect(Library.DetectedAgentSchema).toBeDefined();
      expect(Library.AuthConfigSchema).toBeDefined();
      expect(Library.ProviderAuthInfoSchema).toBeDefined();
      expect(Library.ShareRecordSchema).toBeDefined();
      expect(Library.ShareHistorySchema).toBeDefined();
      expect(Library.McpServerConfigSchema).toBeDefined();
      expect(Library.PluginEntrySchema).toBeDefined();
      expect(Library.RequiredEnvSchema).toBeDefined();
    });

    it("exports utility functions", () => {
      expect(typeof Library.sha256).toBe("function");
      expect(typeof Library.hashObject).toBe("function");
      expect(typeof Library.expandHome).toBe("function");
      expect(typeof Library.isPrototypePollutionKey).toBe("function");
      expect(typeof Library.atomicWriteFileAsync).toBe("function");
      expect(typeof Library.atomicWriteFileSync).toBe("function");
    });

    it("exports all core registries and lifecycle management functions", () => {
      // Auth Providers
      expect(typeof Library.registerAuthProvider).toBe("function");
      expect(typeof Library.unregisterAuthProvider).toBe("function");
      expect(typeof Library.getAuthProvider).toBe("function");
      expect(typeof Library.getAllAuthProviders).toBe("function");
      expect(typeof Library.resetAuthProviders).toBe("function");
      expect(Library.GitHubAuthProvider).toBeDefined();

      // Pack Loaders
      expect(typeof Library.registerPackLoader).toBe("function");
      expect(typeof Library.unregisterPackLoader).toBe("function");
      expect(typeof Library.getPackLoader).toBe("function");
      expect(typeof Library.getAllPackLoaders).toBe("function");
      expect(typeof Library.resetPackLoaders).toBe("function");
      expect(typeof Library.loadPackFromSource).toBe("function");
      expect(typeof Library.collectRequiredEnv).toBe("function");

      // Share Providers
      expect(typeof Library.registerShareProvider).toBe("function");
      expect(typeof Library.unregisterShareProvider).toBe("function");
      expect(typeof Library.getShareProvider).toBe("function");
      expect(typeof Library.getAllShareProviders).toBe("function");
      expect(typeof Library.resetShareProviders).toBe("function");
      expect(Library.GistShareProvider).toBeDefined();
      expect(Library.RepoShareProvider).toBeDefined();
      expect(Library.LocalShareProvider).toBeDefined();

      // MCP Adapters
      expect(typeof Library.registerMcpAdapter).toBe("function");
      expect(typeof Library.unregisterMcpAdapter).toBe("function");
      expect(typeof Library.getMcpAdapter).toBe("function");
      expect(typeof Library.getAllMcpAdapters).toBe("function");
      expect(typeof Library.resetMcpAdapters).toBe("function");
      expect(typeof Library.formatServerForAgent).toBe("function");

      // Redactor
      expect(typeof Library.redactMcpServers).toBe("function");
      expect(typeof Library.registerSecretKeyPatterns).toBe("function");
      expect(typeof Library.registerSecretValuePatterns).toBe("function");
      expect(typeof Library.registerExcludedKeyPatterns).toBe("function");
      expect(typeof Library.registerCustomDetector).toBe("function");
      expect(typeof Library.resetCustomSecretPatterns).toBe("function");
      expect(typeof Library.getSecretPatterns).toBe("function");
      expect(typeof Library.isSecretKey).toBe("function");
      expect(typeof Library.isSecretValue).toBe("function");

      // Agent detection & profiles
      expect(typeof Library.getAgentProfiles).toBe("function");
      expect(typeof Library.saveCustomAgent).toBe("function");
      expect(typeof Library.registerAgentProfile).toBe("function");
      expect(typeof Library.unregisterAgentProfile).toBe("function");
      expect(typeof Library.resetAgentProfiles).toBe("function");
      expect(typeof Library.detectAgents).toBe("function");
      expect(typeof Library.readInstalledMcpServers).toBe("function");
      expect(typeof Library.readInstalledPlugins).toBe("function");
      expect(typeof Library.scanSkills).toBe("function");
      expect(typeof Library.filterAgents).toBe("function");

      // State
      expect(typeof Library.getSmcpDir).toBe("function");
      expect(typeof Library.getConfigPath).toBe("function");
      expect(typeof Library.getSharesPath).toBe("function");
      expect(typeof Library.getAuthConfig).toBe("function");
      expect(typeof Library.saveAuthConfig).toBe("function");
      expect(typeof Library.clearAuthConfig).toBe("function");
      expect(typeof Library.getAuthToken).toBe("function");
      expect(typeof Library.saveProviderAuth).toBe("function");
      expect(typeof Library.clearProviderAuth).toBe("function");
      expect(typeof Library.getSharesHistory).toBe("function");
      expect(typeof Library.recordShare).toBe("function");
      expect(Library.FileStorageProvider).toBeDefined();
      expect(typeof Library.registerStorageProvider).toBe("function");
      expect(typeof Library.getStorageProvider).toBe("function");
      expect(typeof Library.resetStorageProvider).toBe("function");

      // Merger & Installer
      expect(typeof Library.mergeMcpServersIntoFile).toBe("function");
      expect(typeof Library.installSkillFiles).toBe("function");
      expect(typeof Library.mergePluginsIntoFile).toBe("function");
      expect(typeof Library.installPluginFiles).toBe("function");

      // Extensions Loader
      expect(typeof Library.loadUserExtensions).toBe("function");

      // Lifecycle Hooks
      expect(typeof Library.registerHook).toBe("function");
      expect(typeof Library.on).toBe("function");
      expect(typeof Library.unregisterHook).toBe("function");
      expect(typeof Library.triggerHook).toBe("function");
      expect(typeof Library.resetHooks).toBe("function");

      // Network Clients
      expect(Library.GitHubClient).toBeDefined();
      expect(Library.HttpClient).toBeDefined();
      expect(typeof Library.createHttpClient).toBe("function");
    });

    it("exports high-level command functions", () => {
      expect(typeof Library.shareCommand).toBe("function");
      expect(typeof Library.installCommand).toBe("function");
      expect(typeof Library.inspectCommand).toBe("function");
      expect(typeof Library.listCommand).toBe("function");
      expect(typeof Library.instructionsCommand).toBe("function");
      expect(typeof Library.authLoginCommand).toBe("function");
      expect(typeof Library.authLogoutCommand).toBe("function");
      expect(typeof Library.authStatusCommand).toBe("function");
      expect(typeof Library.agentListCommand).toBe("function");
      expect(typeof Library.agentAddCommand).toBe("function");
      expect(typeof Library.agentInstallSkillCommand).toBe("function");

      // CLI command extensibility registry
      expect(typeof Library.registerCliCommand).toBe("function");
      expect(typeof Library.getCliCommandRegistrations).toBe("function");
      expect(typeof Library.resetCliCommands).toBe("function");
    });
  });

  describe("src/core/index.ts headless entrypoint", () => {
    it("exports headless core registries, redactor, merger, agents, auth, pack, and state", () => {
      // Auth
      expect(typeof Core.registerAuthProvider).toBe("function");
      expect(typeof Core.getAuthProvider).toBe("function");
      expect(Core.GitHubAuthProvider).toBeDefined();

      // Pack
      expect(typeof Core.registerPackLoader).toBe("function");
      expect(typeof Core.loadPackFromSource).toBe("function");
      expect(typeof Core.collectRequiredEnv).toBe("function");

      // MCP Adapters
      expect(typeof Core.registerMcpAdapter).toBe("function");
      expect(typeof Core.getMcpAdapter).toBe("function");

      // Redactor
      expect(typeof Core.redactMcpServers).toBe("function");

      // Agents
      expect(typeof Core.detectAgents).toBe("function");
      expect(typeof Core.getAgentProfiles).toBe("function");
      expect(typeof Core.registerAgentProfile).toBe("function");
      expect(typeof Core.unregisterAgentProfile).toBe("function");
      expect(typeof Core.resetAgentProfiles).toBe("function");

      // State
      expect(typeof Core.getSmcpDir).toBe("function");
      expect(typeof Core.getAuthConfig).toBe("function");
      expect(typeof Core.saveProviderAuth).toBe("function");
      expect(typeof Core.getSharesHistory).toBe("function");
      expect(Core.FileStorageProvider).toBeDefined();
      expect(typeof Core.registerStorageProvider).toBe("function");
      expect(typeof Core.getStorageProvider).toBe("function");
      expect(typeof Core.resetStorageProvider).toBe("function");

      // Merger
      expect(typeof Core.mergeMcpServersIntoFile).toBe("function");
      expect(typeof Core.installSkillFiles).toBe("function");

      // Network Clients
      expect(Core.GitHubClient).toBeDefined();
      expect(Core.HttpClient).toBeDefined();

      // Extensions
      expect(typeof Core.loadUserExtensions).toBe("function");

      // Lifecycle Hooks
      expect(typeof Core.registerHook).toBe("function");
      expect(typeof Core.on).toBe("function");
      expect(typeof Core.unregisterHook).toBe("function");
      expect(typeof Core.triggerHook).toBe("function");
      expect(typeof Core.resetHooks).toBe("function");
    });

    it("verifies src/core has ZERO terminal/CLI dependencies", async () => {
      // Check that Core does NOT expose terminal prompt commands
      expect((Core as any).shareCommand).toBeUndefined();
      expect((Core as any).installCommand).toBeUndefined();
      expect((Core as any).createProgram).toBeUndefined();
      expect((Core as any).registerCliCommand).toBeUndefined();
      expect((Core as any).getCliCommandRegistrations).toBeUndefined();
      expect((Core as any).resetCliCommands).toBeUndefined();
    });
  });
});
