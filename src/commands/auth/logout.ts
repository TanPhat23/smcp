import * as p from "@clack/prompts";
import pc from "picocolors";
import { clearAuthConfig } from "../../core/state/index.ts";

export function authLogoutCommand(): void {
  clearAuthConfig();
  p.outro(pc.green("✔ Logged out. Token removed from ~/.smcp/config.json"));
}
