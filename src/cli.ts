import { Command } from "commander";
import { shareCommand } from "./commands/share.ts";
import { installCommand } from "./commands/install.ts";
import { listCommand } from "./commands/list.ts";
import { authLoginCommand, authLogoutCommand, authStatusCommand } from "./commands/auth.ts";
import { agentListCommand, agentAddCommand } from "./commands/agent.ts";
import { inspectCommand } from "./commands/inspect.ts";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("smcp")
    .description("CLI tool to bundle, sanitize, and share AI Agent Skills and MCP server configurations")
    .version("0.1.0");

  program
    .command("share")
    .alias("export")
    .description("Bundle and share local skills and MCP servers")
    .option("-o, --output <dir>", "Export to a local folder instead of GitHub Gist")
    .option("-a, --agents <agents...>", "Filter source agents to share from")
    .option("-s, --servers <servers...>", "Specific MCP servers to share")
    .option("-k, --skills <skills...>", "Specific skills to share")
    .action(async (options) => {
      await shareCommand(options);
    });

  program
    .command("install <source>")
    .alias("add")
    .description("Install an agent pack from a Gist URL or local path")
    .option("-a, --agents <agents...>", "Target agents to install into")
    .option("-f, --force", "Force installation, overwriting existing configurations without prompting")
    .action(async (source, options) => {
      await installCommand(source, options);
    });

  program
    .command("inspect <source>")
    .alias("info")
    .description("Inspect an agent pack details, required env vars, MCP servers, and skills without installing")
    .action(async (source) => {
      await inspectCommand(source);
    });

  program
    .command("list")
    .alias("ls")
    .description("List installed skills and MCP servers across detected agents")
    .action(() => {
      listCommand();
    });

  // Auth subcommands
  const auth = program.command("auth").description("Manage GitHub authentication");

  auth
    .command("login")
    .description("Authenticate with GitHub using a Personal Access Token")
    .action(async () => {
      await authLoginCommand();
    });

  auth
    .command("logout")
    .description("Clear stored GitHub authentication credentials")
    .action(() => {
      authLogoutCommand();
    });

  auth
    .command("status")
    .description("Show current GitHub authentication status")
    .action(async () => {
      await authStatusCommand();
    });

  // Agent subcommands
  const agent = program.command("agent").description("Manage supported AI agent profiles");

  agent
    .command("list")
    .alias("ls")
    .description("List all configured agent profiles")
    .action(() => {
      agentListCommand();
    });

  agent
    .command("add")
    .description("Register a custom AI agent profile")
    .action(async () => {
      await agentAddCommand();
    });

  return program;
}

export function runCli(args: string[] = process.argv): void {
  const program = createProgram();
  program.parse(args);
}

const isDirectRun =
  Boolean((import.meta as any).main) ||
  (typeof process !== "undefined" &&
    process.argv[1] &&
    (process.argv[1].endsWith("smcp.js") ||
      process.argv[1].endsWith("smcp") ||
      process.argv[1].endsWith("cli.js") ||
      process.argv[1].endsWith("cli.ts")) &&
    !process.argv[1].includes("test"));

if (isDirectRun) {
  runCli();
}
