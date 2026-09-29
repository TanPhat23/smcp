import { type AgentProfile } from "../../types/index.ts";
export declare function registerAgentProfile(id: string, profile: AgentProfile): void;
export declare function unregisterAgentProfile(id: string): void;
export declare function resetAgentProfiles(): void;
export declare function getAgentProfiles(customAgentsPath?: string): Record<string, AgentProfile>;
export declare function saveCustomAgent(id: string, profile: AgentProfile, customAgentsPath?: string): void;
