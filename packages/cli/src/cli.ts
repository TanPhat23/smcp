import { Command } from "commander";
import {
  agentAddCommand,
  agentInstallSkillCommand,
  agentListCommand,
  authLoginCommand,
  authLogoutCommand,
  authStatusCommand,
  getCliCommandRegistrations,
  inspectCommand,
  installCommand,
  instructionsCommand,
  listCommand,
  outdatedCommand,
  shareCommand,
  uninstallCommand,
  updateCommand
} from "./commands/index.ts";
import { isPrototypePollutionKey, loadUserExtensions } from "@tanphat/smcp-core";

function parseEnvOptions(rawEnv?: string[]): Record<string, string> {
  if (!rawEnv || !Array.isArray(rawEnv)) return {};
  const result: Record<string, string> = {};
  for (const item of rawEnv) {
    if (typeof item !== "string") continue;
    const parts = item.includes(",") ? item.split(/,(?=[a-zA-Z_][a-zA-Z0-9_]*=)/) : [item];
    for (const part of parts) {
      const eqIdx = part.indexOf("=");
      if (eqIdx > 0) {
        const key = part.slice(0, eqIdx).trim();
        const val = part.slice(eqIdx + 1).trim();
        if (key && !isPrototypePollutionKey(key)) {
          result[key] = val;
        }
      }
    }
  }
  return result;
}

export interface CreateProgramOptions {
  extensionsLoaded?: boolean;
}

export function createProgram(options?: CreateProgramOptions): Command {
  const program = new Command();
  let userExtensionsLoaded = Boolean(options?.extensionsLoaded);

  program
    .name("smcp")
    .description("CLI tool to bundle, sanitize, and share AI Agent Skills and MCP server configurations")
    .version("0.1.9")
    .option("--no-plugins", "Disable loading plugins and extensions")
    .option("--no-extensions", "Disable loading plugins and extensions");

  program.hook("preAction", async () => {
    if (userExtensionsLoaded) return;
    userExtensionsLoaded = true;
    const opts = program.opts();
    const disabled = opts.plugins === false || opts.extensions === false;
    const isJson = Boolean(opts.json);
    await loadUserExtensions({ disabled, json: isJson });
  });

  program
    .command("share")
    .alias("export")
    .description("Bundle and share local skills and MCP servers")
    .option("-P, --provider <provider>", "Share destination provider: gist, repo, or local (default: prompt or gist)")
    .option("-R, --repo <repo>", "Target GitHub repository (e.g. owner/repo or repo-name) when provider is repo")
    .option("--branch <branch>", "Target branch when sharing to a GitHub repository (default: main)")
    .option("-o, --output <dir>", "Export to a local folder instead of GitHub Gist")
    .option("-a, --agents <agents...>", "Filter source agents to share from (e.g. opencode, claude)")
    .option("-s, --servers <servers...>", "Specific MCP servers to share")
    .option("-k, --skills <skills...>", "Specific skills to share")
    .option("-p, --plugins <plugins...>", "Specific plugins to share")
    .option("-n, --name <name>", "Pack name")
    .option("-d, --description <description>", "Pack description")
    .option("--public", "Make published GitHub Gist or repository public")
    .option("--secret-keys <patterns...>", "Custom secret key patterns to redact")
    .option("--secret-values <patterns...>", "Custom secret value regex patterns to redact")
    .option("--exclude-secret-keys <patterns...>", "Key patterns to exclude from secret redaction")
    .option("-y, --yes", "Non-interactive mode, automatically accept defaults")
    .option("--json", "Output results in machine-readable JSON format for AI agents")
    .action(async (options) => {
      await shareCommand(options);
    });

  program
    .command("install <source>")
    .alias("add")
    .description("Install an agent pack from a Gist URL, GitHub repository, or local path")
    .option("-a, --agents <agents...>", "Target agents to install into (e.g. opencode, claude)")
    .option("-f, --force", "Force installation, overwriting existing configurations without prompting")
    .option("-e, --env <vars...>", "Environment variables for installation in KEY=VALUE format")
    .option("--plugin-dir <dir>", "Directory to install local plugin scripts into")
    .option("-r, --runtime <runtime>", "Target package runner / runtime for MCP server commands (e.g. npx, npm, bunx, bun, pnpm)")
    .option("-y, --yes", "Non-interactive mode, automatically accept defaults")
    .option("--json", "Output results in machine-readable JSON format for AI agents")
    .action(async (source, options) => {
      const parsedEnv = options.env ? parseEnvOptions(options.env) : undefined;
      await installCommand(source, {
        ...options,
        env: parsedEnv
      });
    });

  program
    .command("outdated")
    .description("Check installed packs for available updates")
    .option("--json", "Output updates in machine-readable JSON format for AI agents")
    .action(async (options) => {
      await outdatedCommand(options);
    });

  program
    .command("update [pack]")
    .alias("upgrade")
    .description("Update installed agent packs to their newest versions")
    .option("-a, --all", "Update all installed packs with available updates")
    .option("-f, --force", "Force re-installation even if already at latest version")
    .option("-r, --runtime <runtime>", "Target package runner / runtime for MCP server commands (e.g. npx, bunx)")
    .option("-y, --yes", "Non-interactive mode, automatically accept defaults")
    .option("--json", "Output results in machine-readable JSON format for AI agents")
    .action(async (pack, options) => {
      await updateCommand(pack, options);
    });

  program
    .command("uninstall [pack]")
    .alias("remove")
    .description("Uninstall an agent pack and remove its MCP servers, skills, and plugins")
    .option("-y, --yes", "Non-interactive mode, skip confirmation prompt")
    .option("--json", "Output results in machine-readable JSON format for AI agents")
    .action(async (pack, options) => {
      await uninstallCommand(pack, options);
    });

  program
    .command("inspect <source>")
    .alias("info")
    .description("Inspect an agent pack from a Gist URL, GitHub repository, or local path")
    .option("--json", "Output pack inspection in machine-readable JSON format for AI agents")
    .action(async (source, options) => {
      await inspectCommand(source, options);
    });

  program
    .command("list")
    .alias("ls")
    .description("List installed skills and MCP servers across detected agents")
    .option("-a, --agents <agents...>", "Filter agents to display (e.g. opencode, claude)")
    .option("-s, --settings", "Show detailed server settings, commands, arguments, and environment variables")
    .option("-v, --verbose", "Show detailed server and skill settings (alias for --settings)")
    .option("--json", "Output installed configuration in machine-readable JSON format for AI agents")
    .action((options) => {
      listCommand(options);
    });

  // Instructions / Usage for AI agents
  program
    .command("instructions")
    .alias("usage")
    .description("Show AI agent usage guide and instructions")
    .option("--json", "Output instructions in JSON format")
    .action((options) => {
      instructionsCommand(options);
    });

  // Auth subcommands
  const auth = program.command("auth").description("Manage provider authentication (default: github)");

  auth
    .command("login [provider]")
    .description("Authenticate with an auth provider (default: github)")
    .action(async (provider?: string) => {
      await authLoginCommand(provider || "github");
    });

  auth
    .command("logout [provider]")
    .description("Clear stored authentication credentials for a provider (default: github)")
    .action((provider?: string) => {
      authLogoutCommand(provider || "github");
    });

  auth
    .command("status [provider]")
    .description("Show current authentication status for a provider (default: github)")
    .action(async (provider?: string) => {
      await authStatusCommand(provider || "github");
    });

  // Agent subcommands
  const agent = program.command("agent").description("Manage supported AI agent profiles");

  agent
    .command("list")
    .alias("ls")
    .description("List all configured agent profiles")
    .option("--json", "Output agent profiles in JSON format")
    .action((options) => {
      agentListCommand(options);
    });

  agent
    .command("add")
    .description("Register a custom AI agent profile")
    .action(async () => {
      await agentAddCommand();
    });

  agent
    .command("install-skill")
    .description("Install the smcp skill into detected AI agents (OpenCode, Claude Code)")
    .option("--json", "Output installation result in JSON format")
    .action((options) => {
      agentInstallSkillCommand(options);
    });

  // Custom CLI commands registered by plugins
  for (const factory of getCliCommandRegistrations()) {
    try {
      factory(program);
    } catch (err) {
      console.warn(
        `Warning: Failed to register CLI extension command: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return program;
}

export async function runCli(args: string[] = process.argv): Promise<void> {
  const disabled =
    args.includes("--no-plugins") ||
    args.includes("--no-extensions") ||
    process.env.SMCP_DISABLE_EXTENSIONS === "1" ||
    process.env.SMCP_DISABLE_EXTENSIONS === "true";

  if (!disabled) {
    const isJson = args.includes("--json");
    await loadUserExtensions({ json: isJson });
  }

  const program = createProgram({ extensionsLoaded: true });
  await program.parseAsync(args);
}

const isDirectRun =
  (typeof Bun !== "undefined" && Boolean((import.meta as any).main)) ||
  (typeof process !== "undefined" &&
    process.argv[1] &&
    (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("/cli.js")) &&
    !process.argv[1].includes("test") &&
    !process.argv[1].includes("node_modules"));

if (isDirectRun) {
  runCli();
}
