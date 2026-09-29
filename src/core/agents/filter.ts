import type { DetectedAgent } from "../../types/index.ts";

export function filterAgents(
  agents: DetectedAgent[],
  filterList?: string[]
): DetectedAgent[] {
  if (!filterList || filterList.length === 0) {
    return agents;
  }

  const terms = filterList
    .flatMap((entry) => entry.split(","))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (terms.length === 0) {
    return agents;
  }

  return agents.filter((agent) => {
    const id = agent.id.toLowerCase();
    const name = agent.name.toLowerCase();
    return terms.some((term) => {
      if (id === term || name === term) return true;
      if (term === "claude" && (id.startsWith("claude-") || id === "claude")) return true;
      if (term === "opencode" && id === "opencode") return true;
      return id.includes(term) || name.includes(term);
    });
  });
}
