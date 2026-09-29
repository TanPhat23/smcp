import * as p from "@clack/prompts";
import pc from "picocolors";
import { getAuthProvider } from "../../core/auth/index.ts";
import { saveProviderAuth } from "../../core/state/index.ts";

export async function authLoginCommand(provider = "github"): Promise<void> {
  const authProvider = getAuthProvider(provider);
  if (!authProvider) {
    p.log.error(`Unsupported auth provider: '${provider}'.`);
    return;
  }

  const isGitHub = authProvider.id === "github";

  p.intro(
    isGitHub
      ? pc.bgCyan(pc.black(" smcp — GitHub Authentication "))
      : pc.bgCyan(pc.black(` smcp — ${authProvider.name} Authentication `))
  );

  const instructions =
    authProvider.getInstructions?.() ||
    `To authenticate with ${authProvider.name}, smcp requires an API or Personal Access Token.`;

  p.note(instructions, "Instructions");

  const message = isGitHub
    ? "Enter your GitHub Personal Access Token (PAT):"
    : `Enter your ${authProvider.name} Personal Access Token (PAT):`;

  const token = await p.password({
    message,
    validate: (val) => (!val || !val.trim() ? "Token is required" : undefined)
  });

  if (p.isCancel(token) || typeof token !== "string") {
    p.cancel("Authentication cancelled.");
    return;
  }

  const trimmedToken = token.trim();
  const s = p.spinner();
  s.start(
    isGitHub
      ? "Verifying token with GitHub..."
      : `Verifying token with ${authProvider.name}...`
  );

  try {
    const user = await authProvider.verify(trimmedToken);
    saveProviderAuth(authProvider.id, trimmedToken, user);
    s.stop(pc.green(`✔ Authenticated successfully as @${user.username}`));
    p.outro("Saved securely to ~/.smcp/config.json");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    s.stop(pc.red("✖ Authentication failed"));
    p.cancel(message);
  }
}
