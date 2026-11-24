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

  return agents.filter((agent) => agentMatchesTerm(agent.id, agent.name, terms));
}

/**
 * True when any (lowercased) term selects the agent. The bare term "claude"
 * means Claude Code only; Claude Desktop must be named explicitly.
 */
export function agentMatchesTerm(agentId: string, agentName: string, terms: string[]): boolean {
  const id = agentId.toLowerCase();
  const name = agentName.toLowerCase();
  return terms.some((term) => {
    if (id === term || name === term) return true;
    if (term === "claude") return id === "claude" || id === "claude-code";
    if (term === "opencode") return id === "opencode";
    if (term === "agy" || term === "antigravity" || term === "antigravity-cli") return id === "agy";
    return id.includes(term) || name.includes(term);
  });
}
