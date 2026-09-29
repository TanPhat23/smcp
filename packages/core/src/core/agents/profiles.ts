import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentProfileSchema, type AgentProfile } from "../../types/index.ts";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { DEFAULT_AGENTS, deepFreeze } from "./defaults.ts";

let inMemoryAgents: Record<string, AgentProfile> = {};

function validateAgentId(id: unknown): string {
  if (typeof id !== "string") {
    throw new Error("Invalid agent ID: must be a string");
  }
  const trimmedId = id.trim();
  if (
    !trimmedId ||
    isPrototypePollutionKey(trimmedId) ||
    !/^[a-zA-Z0-9_-]+$/.test(trimmedId)
  ) {
    throw new Error(`Invalid agent ID: ${id}`);
  }
  return trimmedId;
}

export function registerAgentProfile(id: string, profile: AgentProfile): void {
  const cleanId = validateAgentId(id);
  const validatedProfile = AgentProfileSchema.parse(profile);
  inMemoryAgents[cleanId] = deepFreeze(structuredClone(validatedProfile));
}

export function unregisterAgentProfile(id: string): void {
  if (typeof id !== "string" || isPrototypePollutionKey(id)) {
    return;
  }
  const cleanId = id.trim();
  delete inMemoryAgents[cleanId];
}

export function resetAgentProfiles(): void {
  inMemoryAgents = {};
}

function getCustomAgentsPath(): string {
  if (process.env.SMCP_CUSTOM_AGENTS_PATH) {
    return expandHome(process.env.SMCP_CUSTOM_AGENTS_PATH);
  }
  const smcpDir = process.env.SMCP_DIR
    ? expandHome(process.env.SMCP_DIR)
    : path.join(os.homedir(), ".smcp");
  return path.join(smcpDir, "custom-agents.json");
}

export function getAgentProfiles(customAgentsPath?: string): Record<string, AgentProfile> {
  const profiles: Record<string, AgentProfile> = structuredClone(DEFAULT_AGENTS);
  const filePath = customAgentsPath ? expandHome(customAgentsPath) : getCustomAgentsPath();

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const custom = JSON.parse(raw);
      if (custom && typeof custom === "object" && !Array.isArray(custom)) {
        for (const [key, value] of Object.entries(custom)) {
          if (isPrototypePollutionKey(key)) continue;
          const parsed = AgentProfileSchema.safeParse(value);
          if (parsed.success) {
            profiles[key] = parsed.data;
          }
        }
      }
    } catch {
      // Ignore corrupt custom config
    }
  }

  for (const [key, value] of Object.entries(inMemoryAgents)) {
    if (isPrototypePollutionKey(key)) continue;
    profiles[key] = structuredClone(value);
  }

  return profiles;
}

export function saveCustomAgent(id: string, profile: AgentProfile, customAgentsPath?: string): void {
  const trimmedId = validateAgentId(id);
  const validatedProfile = AgentProfileSchema.parse(profile);

  const filePath = customAgentsPath ? expandHome(customAgentsPath) : getCustomAgentsPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  let current: Record<string, AgentProfile> = {};
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
          const parsedProfile = AgentProfileSchema.safeParse(v);
          if (parsedProfile.success) {
            current[k] = parsedProfile.data;
          }
        }
      }
    } catch {
      current = {};
    }
  }

  current[trimmedId] = validatedProfile;
  atomicWriteFileSync(filePath, JSON.stringify(current, null, 2), { mode: 0o600 });
}
