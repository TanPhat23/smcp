import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createProgram, runCli } from "../packages/cli/src/cli.ts";
import {
  getCliCommandRegistrations,
  registerCliCommand,
  resetCliCommands
} from "../packages/cli/src/index.ts";
import * as ExtensionsModule from "../packages/core/src/core/extensions/loader.ts";

describe("CLI Plugin Command Extensibility (src/commands/cli-registry)", () => {
  beforeEach(() => {
    resetCliCommands();
    delete process.env.SMCP_DISABLE_EXTENSIONS;
  });

  afterEach(() => {
    resetCliCommands();
    delete process.env.SMCP_DISABLE_EXTENSIONS;
  });

  describe("registerCliCommand & registry management", () => {
    it("validates that factory is a function and throws on invalid inputs", () => {
      expect(() => registerCliCommand(null as any)).toThrow(
        "Invalid CLI command factory: must be a function"
      );
      expect(() => registerCliCommand(undefined as any)).toThrow(
        "Invalid CLI command factory: must be a function"
      );
      expect(() => registerCliCommand({} as any)).toThrow(
        "Invalid CLI command factory: must be a function"
      );
      expect(() => registerCliCommand("not-a-fn" as any)).toThrow(
        "Invalid CLI command factory: must be a function"
      );
      expect(() => registerCliCommand(123 as any)).toThrow(
        "Invalid CLI command factory: must be a function"
      );
    });

    it("registers a custom subcommand that can be verified on createProgram()", () => {
      const factory = (program: any) => {
        program
          .command("doctor")
          .description("Check system health and MCP server status")
          .action(() => {});
      };

      const unsubscribe = registerCliCommand(factory);
      expect(typeof unsubscribe).toBe("function");

      const registrations = getCliCommandRegistrations();
      expect(registrations).toHaveLength(1);
      expect(registrations[0]).toBe(factory);

      const program = createProgram();
      const doctorCmd = program.commands.find((c) => c.name() === "doctor");
      expect(doctorCmd).toBeDefined();
      expect(doctorCmd?.description()).toBe("Check system health and MCP server status");
    });

    it("returns a copy of registered factories so mutating return value does not affect registry", () => {
      registerCliCommand((prog) => {
        prog.command("test1").action(() => {});
      });

      const copy = getCliCommandRegistrations();
      expect(copy).toHaveLength(1);
      copy.length = 0;

      expect(getCliCommandRegistrations()).toHaveLength(1);
    });

    it("removes the command from future createProgram() calls when unsubscribed", () => {
      const unsubscribe = registerCliCommand((prog) => {
        prog.command("temporary").action(() => {});
      });

      // Present before unsubscribe
      let program = createProgram();
      expect(program.commands.some((c) => c.name() === "temporary")).toBe(true);

      // Unsubscribe
      unsubscribe();

      // Calling unsubscribe multiple times is safe and idempotent
      unsubscribe();

      expect(getCliCommandRegistrations()).toHaveLength(0);

      program = createProgram();
      expect(program.commands.some((c) => c.name() === "temporary")).toBe(false);
    });

    it("resetCliCommands() clears all registered custom commands", () => {
      registerCliCommand((prog) => {
        prog.command("cmd1").action(() => {});
      });
      registerCliCommand((prog) => {
        prog.command("cmd2").action(() => {});
      });

      expect(getCliCommandRegistrations()).toHaveLength(2);

      let program = createProgram();
      expect(program.commands.some((c) => c.name() === "cmd1")).toBe(true);
      expect(program.commands.some((c) => c.name() === "cmd2")).toBe(true);

      resetCliCommands();

      expect(getCliCommandRegistrations()).toHaveLength(0);

      program = createProgram();
      expect(program.commands.some((c) => c.name() === "cmd1")).toBe(false);
      expect(program.commands.some((c) => c.name() === "cmd2")).toBe(false);
    });

    it("catches errors inside a CliCommandFactory without crashing createProgram()", () => {
      let warnMessage = "";
      const warnSpy = spyOn(console, "warn").mockImplementation((...args) => {
        warnMessage += args.join(" ");
      });

      try {
        // Register a faulty factory that throws
        registerCliCommand(() => {
          throw new Error("Plugin initialization failed deliberately");
        });

        // Register a working factory after the faulty one
        registerCliCommand((prog) => {
          prog.command("survivor").action(() => {});
        });

        const program = createProgram();
        expect(program).toBeDefined();

        // The working command is still registered
        expect(program.commands.some((c) => c.name() === "survivor")).toBe(true);

        // Warning was logged
        expect(warnMessage).toContain("Warning: Failed to register CLI extension command");
        expect(warnMessage).toContain("Plugin initialization failed deliberately");
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("runCli integration with custom commands", () => {
    it("invokes a custom command through runCli(['node', 'smcp', 'my-custom-cmd', ...])", async () => {
      let actionCalled = false;
      let actionOptions: any = null;
      let actionArg: any = null;

      registerCliCommand((program) => {
        program
          .command("my-custom-cmd <target>")
          .description("Custom plugin test command")
          .option("-f, --flag <value>", "Custom option flag")
          .action((target, options) => {
            actionCalled = true;
            actionArg = target;
            actionOptions = options;
          });
      });

      await runCli([
        "node",
        "smcp",
        "my-custom-cmd",
        "production",
        "--flag",
        "super-power"
      ]);

      expect(actionCalled).toBe(true);
      expect(actionArg).toBe("production");
      expect(actionOptions).toEqual({ flag: "super-power" });
    });

    it("bypasses loadUserExtensions before createProgram when --no-plugins is passed", async () => {
      const loaderSpy = spyOn(ExtensionsModule, "loadUserExtensions");

      try {
        let invoked = false;
        registerCliCommand((program) => {
          program.command("dry-run").action(() => {
            invoked = true;
          });
        });

        await runCli(["node", "smcp", "--no-plugins", "dry-run"]);
        expect(invoked).toBe(true);
        expect(loaderSpy).not.toHaveBeenCalled();
      } finally {
        loaderSpy.mockRestore();
      }
    });

    it("bypasses loadUserExtensions before createProgram when --no-extensions is passed", async () => {
      const loaderSpy = spyOn(ExtensionsModule, "loadUserExtensions");

      try {
        let invoked = false;
        registerCliCommand((program) => {
          program.command("dry-run-ext").action(() => {
            invoked = true;
          });
        });

        await runCli(["node", "smcp", "--no-extensions", "dry-run-ext"]);
        expect(invoked).toBe(true);
        expect(loaderSpy).not.toHaveBeenCalled();
      } finally {
        loaderSpy.mockRestore();
      }
    });

    it("bypasses loadUserExtensions before createProgram when SMCP_DISABLE_EXTENSIONS=1 is set", async () => {
      process.env.SMCP_DISABLE_EXTENSIONS = "1";
      const loaderSpy = spyOn(ExtensionsModule, "loadUserExtensions");

      try {
        let invoked = false;
        registerCliCommand((program) => {
          program.command("dry-run-env").action(() => {
            invoked = true;
          });
        });

        await runCli(["node", "smcp", "dry-run-env"]);
        expect(invoked).toBe(true);
        expect(loaderSpy).not.toHaveBeenCalled();
      } finally {
        loaderSpy.mockRestore();
      }
    });

    it("calls loadUserExtensions before createProgram when plugins are enabled", async () => {
      let callOrder: string[] = [];
      const loaderSpy = spyOn(ExtensionsModule, "loadUserExtensions").mockImplementation(async () => {
        callOrder.push("loadUserExtensions");
        return [];
      });

      try {
        registerCliCommand((program) => {
          program.command("order-check").action(() => {
            callOrder.push("commandAction");
          });
        });

        await runCli(["node", "smcp", "order-check"]);

        expect(callOrder).toEqual(["loadUserExtensions", "commandAction"]);
        expect(loaderSpy).toHaveBeenCalledTimes(1);
      } finally {
        loaderSpy.mockRestore();
      }
    });
  });
});
