import * as p from "@clack/prompts";
import pc from "picocolors";
import { getAgentProfiles, saveCustomAgent } from "../core/agents.ts";

export function agentListCommand(): void {
  p.intro(pc.bgCyan(pc.black(" smcp — Supported Agents ")));
  const profiles = getAgentProfiles();

  for (const [id, profile] of Object.entries(profiles)) {
    console.log(`\n${pc.bold(pc.cyan(profile.name))} (${pc.dim(id)})`);
    if (profile.mcpConfig) {
      console.log(`  MCP Config paths: ${profile.mcpConfig.paths.join(", ")}`);
    } else {
      console.log(`  MCP Config: ${pc.dim("Not supported")}`);
    }
    if (profile.skills) {
      console.log(`  Skills paths: ${profile.skills.paths.join(", ")}`);
    } else {
      console.log(`  Skills: ${pc.dim("Not supported")}`);
    }
  }
  p.outro("");
}

export async function agentAddCommand(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" smcp — Register Custom Agent ")));

  const id = await p.text({
    message: "Agent identifier (e.g. my-agent):",
    validate: (val) => {
      if (!val || !val.trim()) return "Identifier is required";
      const trimmed = val.trim();
      if (trimmed === "__proto__" || trimmed === "constructor" || trimmed === "prototype") {
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

  const trimmedId = id.trim();
  const trimmedName = name.trim();
  const trimmedMcp = typeof mcpPath === "string" ? mcpPath.trim() : "";
  const trimmedSkills = typeof skillsPath === "string" ? skillsPath.trim() : "";

  try {
    saveCustomAgent(trimmedId, {
      name: trimmedName,
      mcpConfig: trimmedMcp ? { paths: [trimmedMcp], key: "mcpServers" } : null,
      skills: trimmedSkills ? { paths: [trimmedSkills] } : null
    });

    p.outro(pc.green(`✔ Saved custom agent '${trimmedId}' to ~/.smcp/custom-agents.json`));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    p.cancel(message);
  }
}
