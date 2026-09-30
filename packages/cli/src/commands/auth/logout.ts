import * as p from "@clack/prompts";
import pc from "picocolors";
import { clearProviderAuth } from "@tanphat/smcp-core";

export function authLogoutCommand(provider = "github"): void {
  clearProviderAuth(provider);
  const isGitHub = provider === "github";
  p.outro(
    pc.green(
      isGitHub
        ? "✔ Logged out. Token removed from ~/.smcp/config.json"
        : `✔ Logged out from ${provider}. Token removed from ~/.smcp/config.json`
    )
  );
}
