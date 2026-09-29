import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getAuthProvider,
  getMcpAdapter,
  getPackLoader,
  getShareProvider,
  loadUserExtensions,
  resetAuthProviders,
  resetMcpAdapters,
  resetPackLoaders,
  resetShareProviders
} from "../src/index.ts";

describe("CLI Extension / Plugin Autoloader (src/core/extensions)", () => {
  let testDir: string;
  let testCwd: string;
  let testSmcpDir: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-ext-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    testCwd = path.join(testDir, "project");
    testSmcpDir = path.join(testDir, "global-smcp");

    fs.mkdirSync(testCwd, { recursive: true });
    fs.mkdirSync(testSmcpDir, { recursive: true });

    delete process.env.SMCP_DISABLE_EXTENSIONS;
  });

  afterEach(() => {
    delete process.env.SMCP_DISABLE_EXTENSIONS;
    resetMcpAdapters();
    resetPackLoaders();
    resetShareProviders();
    resetAuthProviders();

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("loads extension scripts from global plugins, smcp.config, and local plugins directory", async () => {
    // 1. Global plugin
    const globalPluginsDir = path.join(testSmcpDir, "plugins");
    fs.mkdirSync(globalPluginsDir, { recursive: true });
    const globalExt = path.join(globalPluginsDir, "global-ext.ts");
    fs.writeFileSync(globalExt, `// global extension\n`, "utf8");

    // File to exclude in global plugins
    fs.writeFileSync(path.join(globalPluginsDir, "ignored.d.ts"), `export {};\n`, "utf8");
    fs.writeFileSync(path.join(globalPluginsDir, "ignored.test.ts"), `// test\n`, "utf8");

    // 2. smcp.config.ts in cwd
    const configPath = path.join(testCwd, "smcp.config.ts");
    fs.writeFileSync(configPath, `// local config extension\n`, "utf8");

    // 3. Local plugins in .smcp/plugins
    const localPluginsDir = path.join(testCwd, ".smcp", "plugins");
    fs.mkdirSync(localPluginsDir, { recursive: true });
    const localExt = path.join(localPluginsDir, "local-ext.ts");
    fs.writeFileSync(localExt, `// local plugin extension\n`, "utf8");

    const loaded = await loadUserExtensions({ cwd: testCwd, smcpDir: testSmcpDir });

    expect(loaded.length).toBe(3);
    expect(loaded.some((p) => p.endsWith("global-ext.ts"))).toBe(true);
    expect(loaded.some((p) => p.endsWith("smcp.config.ts"))).toBe(true);
    expect(loaded.some((p) => p.endsWith("local-ext.ts"))).toBe(true);
    expect(loaded.some((p) => p.endsWith("ignored.d.ts"))).toBe(false);
    expect(loaded.some((p) => p.endsWith("ignored.test.ts"))).toBe(false);
  });

  it("allows custom scripts to register custom McpAdapter, PackLoader, ShareProvider, and AuthProvider", async () => {
    const globalPluginsDir = path.join(testSmcpDir, "plugins");
    fs.mkdirSync(globalPluginsDir, { recursive: true });
    const registryScript = path.join(globalPluginsDir, "register-custom.ts");

    const indexPath = path.resolve(__dirname, "../src/index.ts");

    fs.writeFileSync(
      registryScript,
      `
import {
  registerMcpAdapter,
  registerPackLoader,
  registerShareProvider,
  registerAuthProvider
} from "${indexPath}";

registerMcpAdapter({
  name: "ext-custom-adapter",
  matches(ctx) {
    return ctx.agentId === "custom-agent";
  },
  serialize(serverConfig) {
    return { ...serverConfig };
  },
  deserialize(rawConfig) {
    return rawConfig as any;
  }
});

registerPackLoader({
  name: "ext-custom-loader",
  matches(ctx) {
    return ctx.source.startsWith("custom-scheme://");
  },
  async load(ctx) {
    return {
      manifest: {
        name: "custom-loaded-pack",
        version: "1.0.0",
        mcpServers: {},
        skills: [],
        requiredEnv: []
      },
      rawFiles: {}
    };
  }
});

registerShareProvider({
  id: "ext-custom-share",
  label: "Extension Custom Share Provider",
  async publish(ctx) {
    return true;
  }
});

registerAuthProvider({
  id: "ext-custom-auth",
  name: "Extension Custom Auth Provider",
  envVars: ["CUSTOM_AUTH_TOKEN"],
  async verify(token) {
    return {
      username: "extuser"
    };
  }
});
`,
      "utf8"
    );

    const loaded = await loadUserExtensions({ cwd: testCwd, smcpDir: testSmcpDir });
    expect(loaded).toContain(registryScript);

    // Verify all four custom registrations are active
    const adapter = getMcpAdapter("ext-custom-adapter");
    expect(adapter).toBeDefined();
    expect(adapter?.name).toBe("ext-custom-adapter");

    const loader = getPackLoader("ext-custom-loader");
    expect(loader).toBeDefined();
    expect(loader?.name).toBe("ext-custom-loader");

    const shareProvider = getShareProvider("ext-custom-share");
    expect(shareProvider).toBeDefined();
    expect(shareProvider?.id).toBe("ext-custom-share");

    const authProvider = getAuthProvider("ext-custom-auth");
    expect(authProvider).toBeDefined();
    expect(authProvider?.id).toBe("ext-custom-auth");
  });

  it("isolates errors when an extension script throws without crashing", async () => {
    const globalPluginsDir = path.join(testSmcpDir, "plugins");
    fs.mkdirSync(globalPluginsDir, { recursive: true });

    // One good plugin and one broken plugin
    const goodScript = path.join(globalPluginsDir, "01-good.ts");
    fs.writeFileSync(goodScript, `// valid script\n`, "utf8");

    const brokenScript = path.join(globalPluginsDir, "02-broken.ts");
    fs.writeFileSync(brokenScript, `throw new Error("Deliberate extension crash");\n`, "utf8");

    let warnMessage = "";
    const warnSpy = spyOn(console, "warn").mockImplementation((...args) => {
      warnMessage += args.join(" ");
    });

    try {
      const loaded = await loadUserExtensions({ cwd: testCwd, smcpDir: testSmcpDir });
      expect(loaded).toContain(goodScript);
      expect(loaded).not.toContain(brokenScript);
      expect(warnMessage).toContain("Warning: Failed to load extension from");
      expect(warnMessage).toContain("Deliberate extension crash");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("disables extension loading when SMCP_DISABLE_EXTENSIONS=1", async () => {
    const globalPluginsDir = path.join(testSmcpDir, "plugins");
    fs.mkdirSync(globalPluginsDir, { recursive: true });
    fs.writeFileSync(path.join(globalPluginsDir, "ext.ts"), `// plugin\n`, "utf8");

    process.env.SMCP_DISABLE_EXTENSIONS = "1";

    const loaded = await loadUserExtensions({ cwd: testCwd, smcpDir: testSmcpDir });
    expect(loaded).toEqual([]);
  });

  it("disables extension loading when options.disabled is true", async () => {
    const globalPluginsDir = path.join(testSmcpDir, "plugins");
    fs.mkdirSync(globalPluginsDir, { recursive: true });
    fs.writeFileSync(path.join(globalPluginsDir, "ext.ts"), `// plugin\n`, "utf8");

    const loaded = await loadUserExtensions({
      cwd: testCwd,
      smcpDir: testSmcpDir,
      disabled: true
    });
    expect(loaded).toEqual([]);
  });

  it("respects --no-plugins and --no-extensions in CLI program", async () => {
    const { createProgram } = await import("../src/cli.ts");
    const program = createProgram();

    // Verify program has both options
    const pluginOption = program.options.find((o) => o.flags.includes("--no-plugins"));
    const extensionOption = program.options.find((o) => o.flags.includes("--no-extensions"));
    expect(pluginOption).toBeDefined();
    expect(extensionOption).toBeDefined();
  });
});
