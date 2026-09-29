import * as p from "@clack/prompts";
import pc from "picocolors";
import path from "node:path";
import { recordShare } from "../../../core/state/index.ts";
import { hashObject } from "../../../utils/crypto.ts";
import { exportPackLocally } from "../export.ts";
import type { ShareProvider, ShareProviderContext } from "./types.ts";

export class LocalShareProvider implements ShareProvider {
  readonly id = "local";
  readonly label = "Local Directory";
  readonly hint = "Export pack directly to a local folder";

  async publish(context: ShareProviderContext): Promise<boolean | void> {
    const {
      manifest,
      bundledSkills,
      bundledPlugins,
      redactedServers,
      selectedServers,
      selectedSkills,
      selectedPlugins,
      targetLocalOutDir,
      cleanPackName,
      version,
      isAgentMode
    } = context;

    const outDir = targetLocalOutDir || path.resolve(`./${cleanPackName}`);
    exportPackLocally(manifest, bundledSkills, outDir, bundledPlugins);

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

    if (isAgentMode) {
      console.log(
        JSON.stringify(
          {
            success: true,
            pack: cleanPackName,
            version,
            type: "local",
            provider: "local",
            location: outDir,
            servers: Object.keys(selectedServers),
            skills: selectedSkills.map((s) => s.name),
            plugins: selectedPlugins.map((p) => (typeof p === "string" ? p : p.name))
          },
          null,
          2
        )
      );
      return true;
    }

    p.outro(pc.green(`✔ Pack successfully exported to ${outDir}`));
    return true;
  }
}
