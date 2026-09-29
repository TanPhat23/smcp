import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installCommand,
  on,
  registerHook,
  registerShareProvider,
  resetHooks,
  resetShareProviders,
  saveCustomAgent,
  shareCommand,
  triggerHook,
  unregisterHook,
  type AfterInstallContext,
  type AfterShareContext,
  type BeforeInstallContext,
  type BeforeShareContext,
  type ShareProvider
} from "../packages/cli/src/index.ts";

describe("Lifecycle Hooks & Middleware Pipeline", () => {
  let testDir: string;
  let originalCustomAgentsPath: string | undefined;

  beforeEach(() => {
    resetHooks();
    resetShareProviders();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "smcp-lifecycle-test-"));
    originalCustomAgentsPath = process.env.SMCP_CUSTOM_AGENTS_PATH;
    process.env.SMCP_CUSTOM_AGENTS_PATH = path.join(testDir, "custom-agents.json");
  });

  afterEach(() => {
    resetHooks();
    resetShareProviders();
    if (originalCustomAgentsPath !== undefined) {
      process.env.SMCP_CUSTOM_AGENTS_PATH = originalCustomAgentsPath;
    } else {
      delete process.env.SMCP_CUSTOM_AGENTS_PATH;
    }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("Hook Registration, Execution & Priority", () => {
    it("registers and triggers a hook with context payload", async () => {
      let calledWith: unknown = null;
      registerHook("beforeShare", (ctx) => {
        calledWith = ctx;
      });

      const payload = { test: 123 } as any;
      await triggerHook("beforeShare", payload);

      expect(calledWith).toBe(payload);
    });

    it("supports 'on' alias for registerHook", async () => {
      let called = false;
      on("beforeInstall", () => {
        called = true;
      });

      await triggerHook("beforeInstall", {} as any);
      expect(called).toBe(true);
    });

    it("executes hooks in ascending order of priority (lower number runs earlier)", async () => {
      const order: number[] = [];

      registerHook("beforeShare", () => {
        order.push(100); // default
      });
      registerHook("beforeShare", () => {
        order.push(200);
      }, { priority: 200 });
      registerHook("beforeShare", () => {
        order.push(10);
      }, { priority: 10 });
      registerHook("beforeShare", () => {
        order.push(-5);
      }, { priority: -5 });
      registerHook("beforeShare", () => {
        order.push(50);
      }, { priority: 50 });

      await triggerHook("beforeShare", {} as any);

      expect(order).toEqual([-5, 10, 50, 100, 200]);
    });

    it("preserves FIFO execution order for hooks with identical priority", async () => {
      const order: string[] = [];

      registerHook("beforeInstall", () => {
        order.push("first");
      }, { priority: 50 });
      registerHook("beforeInstall", () => {
        order.push("second");
      }, { priority: 50 });
      registerHook("beforeInstall", () => {
        order.push("third");
      }, { priority: 50 });

      await triggerHook("beforeInstall", {} as any);

      expect(order).toEqual(["first", "second", "third"]);
    });

    it("awaits asynchronous hook promises in sequential priority order", async () => {
      const order: string[] = [];

      registerHook("beforeShare", async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push("async-early");
      }, { priority: 10 });

      registerHook("beforeShare", async () => {
        order.push("async-late");
      }, { priority: 20 });

      await triggerHook("beforeShare", {} as any);

      expect(order).toEqual(["async-early", "async-late"]);
    });

    it("supports custom string events beyond built-in lifecycle events", async () => {
      let customResult = "";

      registerHook("customSecurityScan", (ctx: { scanTarget: string }) => {
        customResult = `scanned:${ctx.scanTarget}`;
      });

      await triggerHook("customSecurityScan", { scanTarget: "my-mcp-server" });

      expect(customResult).toBe("scanned:my-mcp-server");
    });

    it("does nothing when triggerHook is called on an event with no listeners", async () => {
      await expect(triggerHook("afterInstall", {} as any)).resolves.toBeUndefined();
    });
  });

  describe("Unsubscribe, unregisterHook & resetHooks", () => {
    it("unsubscribes a hook using the returned cleanup function", async () => {
      let callCount = 0;
      const unsubscribe = registerHook("beforeShare", () => {
        callCount++;
      });

      await triggerHook("beforeShare", {} as any);
      expect(callCount).toBe(1);

      unsubscribe();

      await triggerHook("beforeShare", {} as any);
      expect(callCount).toBe(1);
    });

    it("calling unsubscribe multiple times is idempotent and does not throw", async () => {
      let callCount = 0;
      const unsubscribe = registerHook("beforeShare", () => {
        callCount++;
      });

      unsubscribe();
      unsubscribe();
      unsubscribe();

      await triggerHook("beforeShare", {} as any);
      expect(callCount).toBe(0);
    });

    it("unregisters a hook by function reference using unregisterHook", async () => {
      let called = false;
      const fn = () => {
        called = true;
      };

      registerHook("beforeInstall", fn);
      const removed = unregisterHook("beforeInstall", fn);
      expect(removed).toBe(true);

      await triggerHook("beforeInstall", {} as any);
      expect(called).toBe(false);
    });

    it("unregisterHook returns false when event or function is not registered", () => {
      const fn = () => {};
      expect(unregisterHook("beforeInstall", fn)).toBe(false);

      registerHook("beforeInstall", () => {});
      expect(unregisterHook("beforeInstall", fn)).toBe(false);
      expect(unregisterHook("nonExistentEvent", fn)).toBe(false);
    });

    it("resetHooks clears all registered hooks across all events", async () => {
      let shareCalled = false;
      let installCalled = false;

      registerHook("beforeShare", () => {
        shareCalled = true;
      });
      registerHook("beforeInstall", () => {
        installCalled = true;
      });

      resetHooks();

      await triggerHook("beforeShare", {} as any);
      await triggerHook("beforeInstall", {} as any);

      expect(shareCalled).toBe(false);
      expect(installCalled).toBe(false);
    });
  });

  describe("Prototype Pollution Protection & Validation", () => {
    it("rejects prototype pollution keys in registerHook", () => {
      const fn = () => {};
      expect(() => registerHook("__proto__" as any, fn)).toThrow(/prototype pollution/i);
      expect(() => registerHook("constructor" as any, fn)).toThrow(/prototype pollution/i);
      expect(() => registerHook("prototype" as any, fn)).toThrow(/prototype pollution/i);
    });

    it("rejects non-string or empty event in registerHook", () => {
      const fn = () => {};
      expect(() => registerHook("" as any, fn)).toThrow(/non-empty string/i);
      expect(() => registerHook("   " as any, fn)).toThrow(/non-empty string/i);
      expect(() => registerHook(null as any, fn)).toThrow(/non-empty string/i);
      expect(() => registerHook(undefined as any, fn)).toThrow(/non-empty string/i);
    });

    it("rejects non-function handler in registerHook", () => {
      expect(() => registerHook("beforeShare", null as any)).toThrow(/must be a function/i);
      expect(() => registerHook("beforeShare", "notAFunction" as any)).toThrow(/must be a function/i);
    });

    it("rejects prototype pollution keys in triggerHook", async () => {
      await expect(triggerHook("__proto__", {})).rejects.toThrow(/prototype pollution/i);
      await expect(triggerHook("constructor", {})).rejects.toThrow(/prototype pollution/i);
      await expect(triggerHook("prototype", {})).rejects.toThrow(/prototype pollution/i);
    });

    it("rejects non-string or empty event in triggerHook", async () => {
      await expect(triggerHook("", {})).rejects.toThrow(/non-empty string/i);
      await expect(triggerHook("   ", {})).rejects.toThrow(/non-empty string/i);
      await expect(triggerHook(null as any, {})).rejects.toThrow(/non-empty string/i);
    });

    it("unregisterHook returns false for prototype pollution keys and invalid inputs", () => {
      const fn = () => {};
      expect(unregisterHook("__proto__", fn)).toBe(false);
      expect(unregisterHook("constructor", fn)).toBe(false);
      expect(unregisterHook("prototype", fn)).toBe(false);
      expect(unregisterHook("", fn)).toBe(false);
      expect(unregisterHook(null as any, fn)).toBe(false);
      expect(unregisterHook("beforeShare", null as any)).toBe(false);
    });
  });

  describe("Error Propagation & Pipeline Halting", () => {
    it("propagates hook errors out of triggerHook and halts subsequent hooks", async () => {
      const executed: string[] = [];

      registerHook("beforeShare", () => {
        executed.push("first");
      }, { priority: 10 });

      registerHook("beforeShare", () => {
        executed.push("error");
        throw new Error("Security violation detected");
      }, { priority: 20 });

      registerHook("beforeShare", () => {
        executed.push("never");
      }, { priority: 30 });

      await expect(triggerHook("beforeShare", {} as any)).rejects.toThrow("Security violation detected");
      expect(executed).toEqual(["first", "error"]);
    });

    it("propagates async rejected promise errors out of triggerHook", async () => {
      registerHook("beforeInstall", async () => {
        throw new Error("Async verification failed");
      });

      await expect(triggerHook("beforeInstall", {} as any)).rejects.toThrow("Async verification failed");
    });
  });

  describe("shareCommand Lifecycle Integration", () => {
    it("triggers beforeShare and afterShare with accurate context payloads", async () => {
      const agentMcpPath = path.join(testDir, "agent-mcp.json");
      fs.writeFileSync(
        agentMcpPath,
        JSON.stringify({
          mcpServers: {
            mockServer: { command: "node", args: ["server.js"] }
          }
        }),
        "utf8"
      );

      saveCustomAgent("share-test-agent", {
        name: "Share Test Agent",
        mcpConfig: { paths: [agentMcpPath], key: "mcpServers" },
        skills: null
      });

      let capturedBefore: BeforeShareContext | null = null;
      let capturedAfter: AfterShareContext | null = null;

      registerHook("beforeShare", (ctx) => {
        capturedBefore = ctx;
      });

      registerHook("afterShare", (ctx) => {
        capturedAfter = ctx;
      });

      let published = false;
      const testProvider: ShareProvider = {
        id: "mock-share-provider",
        label: "Mock Share Provider",
        publish: async () => {
          published = true;
          return true;
        }
      };
      registerShareProvider(testProvider);

      await shareCommand({
        provider: "mock-share-provider",
        name: "lifecycle-pack",
        servers: ["mockServer"],
        skills: [],
        plugins: [],
        yes: true,
        json: true
      });

      expect(published).toBe(true);
      expect(capturedBefore).not.toBeNull();
      expect(capturedBefore!.manifest.name).toBe("lifecycle-pack");
      expect(capturedBefore!.selectedServers.mockServer).toBeDefined();
      expect(capturedBefore!.redactedServers.mockServer).toBeDefined();
      expect(capturedBefore!.isAgentMode).toBe(true);
      expect(capturedBefore!.isNonInteractive).toBe(true);

      expect(capturedAfter).not.toBeNull();
      expect(capturedAfter!.manifest.name).toBe("lifecycle-pack");
      expect(capturedAfter!.targetProvider).toBe("mock-share-provider");
      expect(capturedAfter!.result).toBe(true);
      expect(capturedAfter!.isAgentMode).toBe(true);
    });

    it("aborts share operation when beforeShare hook throws", async () => {
      const agentMcpPath = path.join(testDir, "agent-mcp.json");
      fs.writeFileSync(
        agentMcpPath,
        JSON.stringify({
          mcpServers: {
            sensitiveServer: { command: "node", args: ["server.js"] }
          }
        }),
        "utf8"
      );

      saveCustomAgent("share-test-agent", {
        name: "Share Test Agent",
        mcpConfig: { paths: [agentMcpPath], key: "mcpServers" },
        skills: null
      });

      registerHook("beforeShare", () => {
        throw new Error("Blocked by enterprise compliance policy");
      });

      let published = false;
      let afterShareCalled = false;
      const testProvider: ShareProvider = {
        id: "mock-share-provider",
        label: "Mock Share Provider",
        publish: async () => {
          published = true;
          return true;
        }
      };
      registerShareProvider(testProvider);

      registerHook("afterShare", () => {
        afterShareCalled = true;
      });

      // Capture console.error output in agent mode
      const errorLogs: string[] = [];
      const origConsoleError = console.error;
      console.error = (...args: any[]) => {
        errorLogs.push(args.join(" "));
      };

      try {
        await shareCommand({
          provider: "mock-share-provider",
          name: "blocked-pack",
          servers: ["sensitiveServer"],
          skills: [],
          plugins: [],
          yes: true,
          json: true
        });
      } finally {
        console.error = origConsoleError;
      }

      // Share provider must NOT have published
      expect(published).toBe(false);
      expect(afterShareCalled).toBe(false);

      // Error was logged gracefully in JSON format
      expect(errorLogs.length).toBeGreaterThan(0);
      const parsedLog = JSON.parse(errorLogs[0]);
      expect(parsedLog.success).toBe(false);
      expect(parsedLog.error).toContain("Blocked by enterprise compliance policy");
    });

    it("isolates errors thrown in afterShare hook as warnings without crashing", async () => {
      const agentMcpPath = path.join(testDir, "agent-mcp-after.json");
      fs.writeFileSync(
        agentMcpPath,
        JSON.stringify({
          mcpServers: {
            safeServer: { command: "node", args: ["server.js"] }
          }
        }),
        "utf8"
      );

      saveCustomAgent("share-after-agent", {
        name: "Share After Agent",
        mcpConfig: { paths: [agentMcpPath], key: "mcpServers" },
        skills: null
      });

      let published = false;
      const testProvider: ShareProvider = {
        id: "mock-after-share-provider",
        label: "Mock After Share Provider",
        publish: async () => {
          published = true;
          return true;
        }
      };
      registerShareProvider(testProvider);

      registerHook("afterShare", () => {
        throw new Error("Telemetry reporting network timeout");
      });

      const warnLogs: string[] = [];
      const origConsoleWarn = console.warn;
      console.warn = (...args: any[]) => {
        warnLogs.push(args.join(" "));
      };

      try {
        await shareCommand({
          provider: "mock-after-share-provider",
          name: "after-share-pack",
          servers: ["safeServer"],
          skills: [],
          plugins: [],
          yes: true,
          json: true
        });
      } finally {
        console.warn = origConsoleWarn;
      }

      // Provider was successfully executed
      expect(published).toBe(true);

      // Warning was logged without crashing the process
      expect(warnLogs.length).toBeGreaterThan(0);
      expect(warnLogs[0]).toContain("Telemetry reporting network timeout");
    });
  });

  describe("installCommand Lifecycle Integration", () => {
    it("triggers beforeInstall and afterInstall with accurate context payloads", async () => {
      // 1. Create a local pack
      const packDir = path.join(testDir, "installable-pack");
      fs.mkdirSync(packDir, { recursive: true });
      const manifest = {
        name: "installable-pack",
        version: "1.0.0",
        description: "Lifecycle test pack",
        mcpServers: {
          testServer: { command: "node", args: ["run.js"] }
        },
        skills: []
      };
      fs.writeFileSync(path.join(packDir, "smcp.json"), JSON.stringify(manifest, null, 2), "utf8");

      // 2. Setup target agent
      const targetMcpFile = path.join(testDir, "target-mcp.json");
      fs.writeFileSync(targetMcpFile, JSON.stringify({ mcpServers: {} }), "utf8");
      saveCustomAgent("lifecycle-install-agent", {
        name: "Lifecycle Install Agent",
        mcpConfig: { paths: [targetMcpFile], key: "mcpServers" },
        skills: null
      });

      let capturedBefore: BeforeInstallContext | null = null;
      let capturedAfter: AfterInstallContext | null = null;

      registerHook("beforeInstall", (ctx) => {
        capturedBefore = ctx;
      });

      registerHook("afterInstall", (ctx) => {
        capturedAfter = ctx;
      });

      await installCommand(packDir, {
        agents: ["lifecycle-install-agent"],
        yes: true,
        json: true
      });

      expect(capturedBefore).not.toBeNull();
      expect(capturedBefore!.source).toBe(packDir);
      expect(capturedBefore!.manifest.name).toBe("installable-pack");
      expect(capturedBefore!.targetAgentIds).toContain("lifecycle-install-agent");
      expect(capturedBefore!.resolvedServers.testServer).toBeDefined();
      expect(capturedBefore!.isAgentMode).toBe(true);

      expect(capturedAfter).not.toBeNull();
      expect(capturedAfter!.source).toBe(packDir);
      expect(capturedAfter!.manifest.name).toBe("installable-pack");
      expect(capturedAfter!.targetAgentIds).toContain("lifecycle-install-agent");
      expect(capturedAfter!.installedMcp).toContain("lifecycle-install-agent");

      // Check agent config updated
      const updatedConfig = JSON.parse(fs.readFileSync(targetMcpFile, "utf8"));
      expect(updatedConfig.mcpServers.testServer).toBeDefined();
    });

    it("aborts install operation when beforeInstall hook throws", async () => {
      const packDir = path.join(testDir, "aborted-pack");
      fs.mkdirSync(packDir, { recursive: true });
      const manifest = {
        name: "aborted-pack",
        version: "1.0.0",
        mcpServers: {
          maliciousServer: { command: "rm", args: ["-rf", "/"] }
        },
        skills: []
      };
      fs.writeFileSync(path.join(packDir, "smcp.json"), JSON.stringify(manifest, null, 2), "utf8");

      const targetMcpFile = path.join(testDir, "target-mcp.json");
      fs.writeFileSync(targetMcpFile, JSON.stringify({ mcpServers: {} }), "utf8");
      saveCustomAgent("lifecycle-abort-agent", {
        name: "Lifecycle Abort Agent",
        mcpConfig: { paths: [targetMcpFile], key: "mcpServers" },
        skills: null
      });

      registerHook("beforeInstall", () => {
        throw new Error("Malicious MCP server detected");
      });

      let afterInstallCalled = false;
      registerHook("afterInstall", () => {
        afterInstallCalled = true;
      });

      // Capture console.error in agent mode
      const errorLogs: string[] = [];
      const origConsoleError = console.error;
      console.error = (...args: any[]) => {
        errorLogs.push(args.join(" "));
      };

      try {
        await installCommand(packDir, {
          agents: ["lifecycle-abort-agent"],
          yes: true,
          json: true
        });
      } finally {
        console.error = origConsoleError;
      }

      expect(afterInstallCalled).toBe(false);

      // Verify target file was not modified
      const configAfter = JSON.parse(fs.readFileSync(targetMcpFile, "utf8"));
      expect(configAfter.mcpServers.maliciousServer).toBeUndefined();

      // Verify error was logged gracefully
      expect(errorLogs.length).toBeGreaterThan(0);
      const parsedLog = JSON.parse(errorLogs[0]);
      expect(parsedLog.success).toBe(false);
      expect(parsedLog.error).toContain("Malicious MCP server detected");
    });

    it("isolates errors thrown in afterInstall hook as warnings without failing installation", async () => {
      const packDir = path.join(testDir, "after-install-pack");
      fs.mkdirSync(packDir, { recursive: true });
      const manifest = {
        name: "after-install-pack",
        version: "1.0.0",
        mcpServers: {
          installedServer: { command: "node", args: ["srv.js"] }
        },
        skills: []
      };
      fs.writeFileSync(path.join(packDir, "smcp.json"), JSON.stringify(manifest, null, 2), "utf8");

      const targetMcpFile = path.join(testDir, "target-after-mcp.json");
      fs.writeFileSync(targetMcpFile, JSON.stringify({ mcpServers: {} }), "utf8");
      saveCustomAgent("lifecycle-after-agent", {
        name: "Lifecycle After Agent",
        mcpConfig: { paths: [targetMcpFile], key: "mcpServers" },
        skills: null
      });

      registerHook("afterInstall", () => {
        throw new Error("Post-install notification service down");
      });

      const warnLogs: string[] = [];
      const infoLogs: string[] = [];
      const origConsoleWarn = console.warn;
      const origConsoleLog = console.log;
      console.warn = (...args: any[]) => {
        warnLogs.push(args.join(" "));
      };
      console.log = (...args: any[]) => {
        infoLogs.push(args.join(" "));
      };

      try {
        await installCommand(packDir, {
          agents: ["lifecycle-after-agent"],
          force: true,
          yes: true,
          json: true
        });
      } finally {
        console.warn = origConsoleWarn;
        console.log = origConsoleLog;
      }

      // Verify files WERE installed
      const configAfter = JSON.parse(fs.readFileSync(targetMcpFile, "utf8"));
      expect(configAfter.mcpServers.installedServer).toBeDefined();

      // Warning was captured
      expect(warnLogs.length).toBeGreaterThan(0);
      expect(warnLogs[0]).toContain("Post-install notification service down");

      // Success output was still logged
      expect(infoLogs.length).toBeGreaterThan(0);
      const parsedLog = JSON.parse(infoLogs[0]);
      expect(parsedLog.success).toBe(true);
      expect(parsedLog.pack).toBe("after-install-pack");
    });
  });
});
