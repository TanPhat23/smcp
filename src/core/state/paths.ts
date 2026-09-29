import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandHome } from "../../utils/paths.ts";

export function getSmcpDir(): string {
  if (process.env.SMCP_DIR && process.env.SMCP_DIR.trim().length > 0) {
    return expandHome(process.env.SMCP_DIR.trim());
  }
  return path.join(os.homedir(), ".smcp");
}

export function getConfigPath(): string {
  return path.join(getSmcpDir(), "config.json");
}

export function getSharesPath(): string {
  return path.join(getSmcpDir(), "shares.json");
}

export function ensureSmcpDir(): void {
  const dir = getSmcpDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
