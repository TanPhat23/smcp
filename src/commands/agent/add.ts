import * as p from "@clack/prompts";
import pc from "picocolors";
import { saveCustomAgent } from "../../core/agents/index.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";

export async function agentAddCommand(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" smcp — Register Custom Agent ")));

  const id = await p.text({
    message: "Agent identifier (e.g. my-agent):",
    validate: (val) => {
      if (!val || !val.trim()) return "Identifier is required";
      const trimmed = val.trim();
      if (isPrototypePollutionKey(trimmed)) {
        return "Invalid identifier";
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
        return "Must be alphanumeric (hyphens/underscores allowed)";
      }
      return undefined;
    }
  });
  if (p.isCancel(id) || typeof id !== "string") {
    p.cancel("Operation cancelled.");
    return;
  }

  const name = await p.text({
    message: "Display name (e.g. My Custom Agent):",
    validate: (val) => (!val || !val.trim() ? "Name required" : undefined)
  });
  if (p.isCancel(name) || typeof name !== "string") {
    p.cancel("Operation cancelled.");
    return;
  }

  const mcpPath = await p.text({
    message: "MCP Config file path (optional, leave blank if none):"
  });
  if (p.isCancel(mcpPath)) {
    p.cancel("Operation cancelled.");
    return;
  }

  const skillsPath = await p.text({
    message: "Skills directory path (optional, leave blank if none):"
  });
  if (p.isCancel(skillsPath)) {
    p.cancel("Operation cancelled.");
    return;
  }

  const pluginsPath = await p.text({
    message: "Plugins config file path (optional, leave blank if none):"
  });
  if (p.isCancel(pluginsPath)) {
    p.cancel("Operation cancelled.");
    return;
  }

  const pluginsDir = await p.text({
    message: "Local plugins directory path (optional, leave blank if none):"
  });
  if (p.isCancel(pluginsDir)) {
    p.cancel("Operation cancelled.");
    return;
  }

  const trimmedId = id.trim();
  const trimmedName = name.trim();
  const trimmedMcp = typeof mcpPath === "string" ? mcpPath.trim() : "";
  const trimmedSkills = typeof skillsPath === "string" ? skillsPath.trim() : "";
  const trimmedPlugins = typeof pluginsPath === "string" ? pluginsPath.trim() : "";
  const trimmedPluginsDir = typeof pluginsDir === "string" ? pluginsDir.trim() : "";

  try {
    saveCustomAgent(trimmedId, {
      name: trimmedName,
      mcpConfig: trimmedMcp ? { paths: [trimmedMcp], key: "mcpServers" } : null,
      skills: trimmedSkills ? { paths: [trimmedSkills] } : null,
      plugins: trimmedPlugins
        ? {
            paths: [trimmedPlugins],
            key: "plugin",
            format: "array",
            dirPaths: trimmedPluginsDir ? [trimmedPluginsDir] : undefined
          }
        : null
    });
    p.outro(pc.green(`✔ Saved custom agent '${trimmedId}' to ~/.smcp/custom-agents.json`));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    p.cancel(`Failed to save agent: ${message}`);
  }
}
