import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { detectAgents, getAgentProfiles, readInstalledMcpServers, scanSkills } from "../core/agents.ts";
import { GitHubClient } from "../core/github.ts";
import { redactMcpServers } from "../core/redactor.ts";
import { getAuthConfig, getSharesHistory, recordShare } from "../core/state.ts";
import type { Manifest, McpServerConfig, SkillEntry } from "../types.ts";
import { hashObject } from "../utils/crypto.ts";
import { authLoginCommand } from "./auth.ts";

export interface ShareCommandOptions {
  output?: string;
  name?: string;
  description?: string;
  servers?: string[];
  skills?: string[];
  isPublic?: boolean;
}

export function bundleSkillFiles(skills: SkillEntry[]): {
  bundledSkills: SkillEntry[];
  gistFiles: Record<string, { content: string }>;
} {
  const bundledSkills: SkillEntry[] = [];
  const gistFiles: Record<string, { content: string }> = {};

  for (const sk of skills) {
    const skillFiles: Record<string, string> = {};
    const resolvedPath = path.resolve(sk.path);

    let skillDir: string | null = null;
    if (fs.existsSync(resolvedPath)) {
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        skillDir = resolvedPath;
      } else if (stat.isFile()) {
        const parentDir = path.dirname(resolvedPath);
        if (
          path.basename(parentDir) === sk.name &&
          fs.existsSync(parentDir) &&
          fs.statSync(parentDir).isDirectory()
        ) {
          skillDir = parentDir;
        }
      }
    }

    if (skillDir) {
      const allEntries = fs.readdirSync(skillDir, { recursive: true });
      for (const entry of allEntries) {
        const full = path.join(skillDir, entry as string);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          const rel = path.relative(skillDir, full).replaceAll("\\", "/");
          const segments = rel.split("/");
          if (segments.some((seg) => seg.startsWith("."))) {
            continue;
          }
          const content = fs.readFileSync(full, "utf8");
          skillFiles[rel] = content;
          gistFiles[`skills_${sk.name}_${rel.replaceAll("/", "_")}`] = { content };
        }
      }
    }

    if (Object.keys(skillFiles).length === 0) {
      const content =
        fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()
          ? fs.readFileSync(resolvedPath, "utf8")
          : `# ${sk.name}\n\n${sk.description || ""}\n`;
      skillFiles["SKILL.md"] = content;
      gistFiles[`skills_${sk.name}_SKILL.md`] = { content };
    }

    bundledSkills.push({
      name: sk.name,
      path: `skills/${sk.name}/SKILL.md`,
      description: sk.description,
      contentHash: hashObject(skillFiles),
      files: skillFiles
    });
  }

  return { bundledSkills, gistFiles };
}

export function exportPackLocally(
  manifest: Manifest,
  bundledSkills: SkillEntry[],
  outputDir: string
): void {
  const outDir = path.resolve(outputDir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "smcp.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  for (const sk of bundledSkills) {
    if (sk.files) {
      const skDir = path.join(outDir, "skills", sk.name);
      fs.mkdirSync(skDir, { recursive: true });
      for (const [fn, cnt] of Object.entries(sk.files)) {
        const filePath = path.join(skDir, fn);
        const parent = path.dirname(filePath);
        if (!fs.existsSync(parent)) {
          fs.mkdirSync(parent, { recursive: true });
        }
        fs.writeFileSync(filePath, cnt, "utf8");
      }
    }
  }
}

export async function shareCommand(options?: ShareCommandOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" smcp — Share Skills & MCPs ")));

  const agents = detectAgents();
  if (agents.length === 0) {
    p.cancel("No supported AI agents found on this machine.");
    return;
  }

  // 1. Collect all available MCP servers
  const profiles = getAgentProfiles();
  const availableServers: Record<string, McpServerConfig> = {};
  for (const agent of agents) {
    if (agent.mcpConfigPath) {
      const profile = profiles[agent.id];
      const servers = readInstalledMcpServers(
        agent.mcpConfigPath,
        profile?.mcpConfig?.key || "mcpServers"
      );
      Object.assign(availableServers, servers);
    }
  }

  // 2. Collect all available skills
  const availableSkills: SkillEntry[] = [];
  for (const agent of agents) {
    if (agent.skillsDirPath) {
      const skills = scanSkills(agent.skillsDirPath);
      for (const s of skills) {
        if (!availableSkills.some((existing) => existing.name === s.name)) {
          availableSkills.push(s);
        }
      }
    }
  }

  const serverNames = Object.keys(availableServers);
  if (serverNames.length === 0 && availableSkills.length === 0) {
    p.cancel("No MCP servers or skills found to share.");
    return;
  }

  // 3. Select MCP servers
  let selectedServers: Record<string, McpServerConfig> = {};
  if (options?.servers !== undefined) {
    for (const name of options.servers) {
      if (availableServers[name]) {
        selectedServers[name] = availableServers[name];
      }
    }
  } else if (serverNames.length > 0) {
    const picked = await p.multiselect({
      message: "Select MCP Servers to include:",
      options: serverNames.map((name) => ({
        value: name,
        label: name,
        hint: availableServers[name].command || availableServers[name].url
      })),
      required: false
    });
    if (p.isCancel(picked)) {
      p.cancel("Operation cancelled.");
      return;
    }
    for (const name of picked as string[]) {
      selectedServers[name] = availableServers[name];
    }
  }

  // 4. Select skills
  let selectedSkills: SkillEntry[] = [];
  if (options?.skills !== undefined) {
    selectedSkills = availableSkills.filter((sk) => options.skills?.includes(sk.name));
  } else if (availableSkills.length > 0) {
    const picked = await p.multiselect({
      message: "Select Skills to include:",
      options: availableSkills.map((sk) => ({
        value: sk.name,
        label: sk.name,
        hint: sk.path
      })),
      required: false
    });
    if (p.isCancel(picked)) {
      p.cancel("Operation cancelled.");
      return;
    }
    selectedSkills = availableSkills.filter((sk) => (picked as string[]).includes(sk.name));
  }

  if (Object.keys(selectedServers).length === 0 && selectedSkills.length === 0) {
    p.cancel("No items selected.");
    return;
  }

  // 5. Redact secrets
  const sRedact = p.spinner();
  sRedact.start("Analyzing and redacting sensitive credentials...");
  const { redactedServers, requiredEnv } = redactMcpServers(selectedServers);
  sRedact.stop(pc.green(`✔ Redacted secrets. Generated ${requiredEnv.length} environment placeholders.`));

  // 6. Pack Details
  let packName = options?.name;
  if (!packName) {
    const answer = await p.text({
      message: "Pack name:",
      defaultValue: "my-agent-pack",
      placeholder: "my-agent-pack",
      validate: (val) => {
        if (!val || !val.trim()) return "Pack name is required";
        if (!/^[a-zA-Z0-9_-]+$/.test(val.trim())) {
          return "Must be alphanumeric (hyphens/underscores allowed)";
        }
        return undefined;
      }
    });
    if (p.isCancel(answer) || typeof answer !== "string") {
      p.cancel("Operation cancelled.");
      return;
    }
    packName = answer;
  }
  const cleanPackName = packName.trim();

  let packDesc = options?.description;
  if (packDesc === undefined) {
    const answer = await p.text({
      message: "Pack description:",
      defaultValue: "Shared Skills and MCP stack",
      placeholder: "Shared Skills and MCP stack"
    });
    if (p.isCancel(answer) || typeof answer !== "string") {
      p.cancel("Operation cancelled.");
      return;
    }
    packDesc = typeof answer === "string" ? answer : "Shared Skills and MCP stack";
  }
  const cleanPackDesc = (packDesc && packDesc.trim()) || "Shared Skills and MCP stack";

  // 7. Check existing shares & version bump
  const history = getSharesHistory();
  const existingShare = history.shares.find((s) => s.name === cleanPackName);
  let version = "1.0.0";
  let targetGistId: string | undefined = undefined;

  if (existingShare) {
    const parts = existingShare.version.split(".").map(Number);
    const nextPatch =
      parts.length === 3 && parts.every((n) => !isNaN(n))
        ? `${parts[0]}.${parts[1]}.${parts[2] + 1}`
        : "1.0.1";

    if (options?.name !== undefined) {
      // In non-interactive mode, default to updating
      version = nextPatch;
      targetGistId = existingShare.gistId;
    } else {
      const action = await p.select({
        message: `Pack '${cleanPackName}' was previously shared (${existingShare.version}). How to proceed?`,
        options: [
          { value: "update", label: `Update existing share (bumps to v${nextPatch})` },
          { value: "new", label: "Create new standalone share" }
        ]
      });
      if (p.isCancel(action)) {
        p.cancel("Operation cancelled.");
        return;
      }

      if (action === "update") {
        version = nextPatch;
        targetGistId = existingShare.gistId;
      }
    }
  }

  // 8. Bundle skill files
  const { bundledSkills, gistFiles } = bundleSkillFiles(selectedSkills);

  const manifest: Manifest = {
    $schema: "https://smcp.dev/schema.json",
    name: cleanPackName,
    version,
    description: cleanPackDesc,
    createdAt: existingShare?.lastSharedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mcpServers: redactedServers,
    skills: bundledSkills,
    requiredEnv
  };

  gistFiles["smcp.json"] = { content: JSON.stringify(manifest, null, 2) };

  // 9. Local export if --output <dir>
  if (options?.output) {
    const outDir = path.resolve(options.output);
    exportPackLocally(manifest, bundledSkills, outDir);

    const serverFingerprints: Record<string, string> = {};
    for (const [k, v] of Object.entries(redactedServers)) {
      serverFingerprints[k] = hashObject(v);
    }
    const skillFingerprints: Record<string, string> = {};
    for (const sk of bundledSkills) {
      skillFingerprints[sk.name] = sk.contentHash || "";
    }

    recordShare({
      name: cleanPackName,
      version,
      targetType: "local",
      targetUrl: outDir,
      lastSharedAt: new Date().toISOString(),
      fingerprints: {
        mcpServers: serverFingerprints,
        skills: skillFingerprints
      }
    });

    p.outro(pc.green(`✔ Pack successfully exported to ${outDir}`));
    return;
  }

  // 10. GitHub Gist Publishing
  let auth = getAuthConfig();
  if (!auth.githubToken) {
    await authLoginCommand();
    auth = getAuthConfig();
    if (!auth.githubToken) {
      p.cancel("Cannot publish without GitHub token.");
      return;
    }
  }

  let isPublic = options?.isPublic;
  if (isPublic === undefined) {
    const answer = await p.confirm({
      message: "Make Gist public? (No = secret unlisted Gist)",
      initialValue: true
    });
    if (p.isCancel(answer)) {
      p.cancel("Operation cancelled.");
      return;
    }
    isPublic = Boolean(answer);
  }

  const sPub = p.spinner();
  sPub.start("Publishing pack to GitHub Gist...");

  try {
    const client = new GitHubClient(auth.githubToken);
    let resultUrl = "";
    let finalGistId = targetGistId;

    if (targetGistId) {
      const res = await client.updateGist(targetGistId, {
        description: `[smcp] ${cleanPackName} v${version} - ${cleanPackDesc}`,
        files: gistFiles
      });
      resultUrl = res.html_url;
    } else {
      const res = await client.createGist({
        description: `[smcp] ${cleanPackName} v${version} - ${cleanPackDesc}`,
        public: isPublic,
        files: gistFiles
      });
      resultUrl = res.html_url;
      finalGistId = res.id;
    }

    const serverFingerprints: Record<string, string> = {};
    for (const [k, v] of Object.entries(redactedServers)) {
      serverFingerprints[k] = hashObject(v);
    }
    const skillFingerprints: Record<string, string> = {};
    for (const sk of bundledSkills) {
      skillFingerprints[sk.name] = sk.contentHash || "";
    }

    recordShare({
      name: cleanPackName,
      version,
      targetType: "gist",
      targetUrl: resultUrl,
      gistId: finalGistId,
      lastSharedAt: new Date().toISOString(),
      fingerprints: {
        mcpServers: serverFingerprints,
        skills: skillFingerprints
      }
    });

    sPub.stop(pc.green(`✔ Pack published: ${pc.bold(resultUrl)}`));

    p.note(
      `Share this pack with anyone:\n  ${pc.cyan(`npx smcp install ${resultUrl}`)}`,
      "Share Command"
    );
    p.outro(pc.green("Done!"));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sPub.stop(pc.red("✖ Failed to publish pack"));
    p.cancel(message);
  }
}
