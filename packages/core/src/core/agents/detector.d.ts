import { type AgentProfile, type DetectedAgent } from "../../types/index.ts";
export declare function resolveActiveAgentPath(paths?: string[]): string | null;
export declare function detectAgents(profiles?: Record<string, AgentProfile>): DetectedAgent[];
