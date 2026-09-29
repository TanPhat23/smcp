import type { Command } from "commander";

export type CliCommandFactory = (program: Command) => void;

const cliCommandRegistrations: CliCommandFactory[] = [];

/**
 * Registers a custom CLI command factory that extends the Commander program.
 * Validates that factory is a function, adds it to the registry,
 * and returns an unsubscribe function to remove the factory.
 */
export function registerCliCommand(factory: CliCommandFactory): () => void {
  if (typeof factory !== "function") {
    throw new Error("Invalid CLI command factory: must be a function");
  }

  cliCommandRegistrations.push(factory);

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    const index = cliCommandRegistrations.indexOf(factory);
    if (index !== -1) {
      cliCommandRegistrations.splice(index, 1);
    }
  };
}

/**
 * Returns a copy of the registered CLI command factories.
 */
export function getCliCommandRegistrations(): CliCommandFactory[] {
  return [...cliCommandRegistrations];
}

/**
 * Clears all registered CLI command factories from the registry.
 */
export function resetCliCommands(): void {
  cliCommandRegistrations.length = 0;
}
