import type { McpAdapter, McpAdapterContext } from "../../../types/index.ts";
import { isPrototypePollutionKey } from "../../../utils/security.ts";
import { OpenCodeMcpAdapter } from "./opencode.ts";
import { StandardMcpAdapter } from "./standard.ts";

function createDefaultAdapters(): McpAdapter[] {
  return [
    Object.freeze(new OpenCodeMcpAdapter()),
    Object.freeze(new StandardMcpAdapter())
  ];
}

let activeAdapters: McpAdapter[] = createDefaultAdapters();

/**
 * Validates that an adapter satisfies the full McpAdapter contract.
 */
function validateAdapter(adapter: unknown): asserts adapter is McpAdapter {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw new Error("Invalid MCP adapter: must be a non-null object");
  }

  const candidate = adapter as Record<string, unknown>;

  if (
    typeof candidate.name !== "string" ||
    !candidate.name.trim() ||
    !/^[a-zA-Z0-9_-]+$/.test(candidate.name.trim()) ||
    candidate.name.length > 64
  ) {
    throw new Error(
      `Invalid adapter name: must be 1-64 alphanumeric characters, underscores, or hyphens`
    );
  }

  if (isPrototypePollutionKey(candidate.name)) {
    throw new Error(`Invalid adapter name: prototype pollution key '${candidate.name}' is rejected`);
  }

  if (typeof candidate.matches !== "function") {
    throw new Error(`Adapter '${candidate.name}' must implement a 'matches(context)' function`);
  }

  if (typeof candidate.serialize !== "function") {
    throw new Error(`Adapter '${candidate.name}' must implement a 'serialize(serverConfig, context, existingServer?)' function`);
  }

  if (typeof candidate.deserialize !== "function") {
    throw new Error(`Adapter '${candidate.name}' must implement a 'deserialize(rawConfig, context?)' function`);
  }
}

/**
 * Registers a new MCP adapter for custom agent formats.
 * User-registered adapters take precedence over built-in adapters.
 */
export function registerMcpAdapter(adapter: McpAdapter, prepend = true): void {
  validateAdapter(adapter);

  // Freeze the registered adapter to prevent post-registration tampering
  const safeAdapter = Object.isFrozen(adapter) ? adapter : Object.freeze({ ...adapter });

  // Remove existing adapter with same name if present
  activeAdapters = activeAdapters.filter((a) => a.name !== safeAdapter.name);

  if (prepend) {
    activeAdapters.unshift(safeAdapter);
  } else {
    activeAdapters.push(safeAdapter);
  }
}

/**
 * Unregisters an MCP adapter by name.
 */
export function unregisterMcpAdapter(name: string): boolean {
  if (!name || typeof name !== "string" || isPrototypePollutionKey(name)) {
    return false;
  }
  const initialLength = activeAdapters.length;
  activeAdapters = activeAdapters.filter((a) => a.name !== name.trim());
  return activeAdapters.length < initialLength;
}

/**
 * Returns a defensive read-only snapshot of all active MCP adapters.
 */
export function getAllMcpAdapters(): readonly McpAdapter[] {
  return Object.freeze([...activeAdapters]);
}

/**
 * Resets all active MCP adapters to the default built-ins.
 */
export function resetMcpAdapters(): void {
  activeAdapters = createDefaultAdapters();
}

/**
 * Resolves the appropriate MCP adapter for a given format name or context.
 * If a name is passed, resolves by exact name match.
 * If a context is passed, safely evaluates `adapter.matches(context)`.
 * Falls back to a guaranteed instance of StandardMcpAdapter.
 */
export function getMcpAdapter(
  nameOrContext?: string | McpAdapterContext
): McpAdapter {
  if (typeof nameOrContext === "string") {
    const cleanName = nameOrContext.trim();
    if (!isPrototypePollutionKey(cleanName)) {
      const found = activeAdapters.find((a) => a.name === cleanName);
      if (found) return found;
    }
  } else if (nameOrContext && typeof nameOrContext === "object" && !Array.isArray(nameOrContext)) {
    // If format explicitly specifies an adapter name
    if (typeof nameOrContext.format === "string") {
      const formatName = nameOrContext.format.trim();
      if (!isPrototypePollutionKey(formatName)) {
        const explicit = activeAdapters.find((a) => a.name === formatName);
        if (explicit) return explicit;
      }
    }

    // Otherwise test matches() in priority order with error isolation
    for (const adapter of activeAdapters) {
      try {
        if (adapter.matches(nameOrContext)) {
          return adapter;
        }
      } catch {
        // Isolate buggy/throwing custom adapter implementations
        continue;
      }
    }
  }

  // Fallback to standard adapter or fresh instance
  const standard = activeAdapters.find((a) => a.name === "standard");
  return standard || Object.freeze(new StandardMcpAdapter());
}
