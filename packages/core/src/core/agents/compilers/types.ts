import type { CompiledAgentFile, UniversalAgent } from "../../../types/index.ts";

export type { CompiledAgentFile };

export type AgentCompiler = (agent: UniversalAgent) => CompiledAgentFile;
