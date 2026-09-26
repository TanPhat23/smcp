import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AuthConfigSchema,
  ShareHistorySchema,
  ShareRecordSchema,
  type AuthConfig,
  type ShareHistory,
  type ShareRecord
} from "../types.ts";
import { expandHome } from "../utils/paths.ts";

export function getSmcpDir(): string {
  if (process.env.SMCP_DIR && process.env.SMCP_DIR.trim().length > 0) {
    return expandHome(process.env.SMCP_DIR.trim());
  }
  return path.join(os.homedir(), ".smcp");
}

function getConfigPath(): string {
  return path.join(getSmcpDir(), "config.json");
}

function getSharesPath(): string {
  return path.join(getSmcpDir(), "shares.json");
}

function ensureSmcpDir(): void {
  const dir = getSmcpDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function atomicWriteFileSync(
  filePath: string,
  content: string,
  options?: { mode?: number }
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempFile = path.join(
    dir,
    `.${path.basename(filePath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );

  let targetMode = options?.mode;
  if (targetMode === undefined && fs.existsSync(filePath)) {
    try {
      targetMode = fs.statSync(filePath).mode & 0o777;
    } catch {
      targetMode = undefined;
    }
  }

  try {
    if (targetMode !== undefined) {
      fs.writeFileSync(tempFile, content, { mode: targetMode });
      try {
        fs.chmodSync(tempFile, targetMode);
      } catch {
        // Non-POSIX platforms
      }
    } else {
      fs.writeFileSync(tempFile, content, "utf8");
    }

    fs.renameSync(tempFile, filePath);

    if (targetMode !== undefined) {
      try {
        fs.chmodSync(filePath, targetMode);
      } catch {
        // Non-POSIX platforms
      }
    }
  } catch (error) {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup error
    }
    throw error;
  }
}

export function getAuthConfig(): AuthConfig {
  ensureSmcpDir();
  const configFile = getConfigPath();
  let saved: AuthConfig = {};

  if (fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile, "utf8");
      const parsed = JSON.parse(raw);
      const validated = AuthConfigSchema.safeParse(parsed);
      if (validated.success) {
        saved = validated.data;
      }
    } catch {
      saved = {};
    }
  }

  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim().length > 0) {
    return {
      ...saved,
      githubToken: process.env.GITHUB_TOKEN.trim()
    };
  }

  return saved;
}

export function saveAuthConfig(config: AuthConfig): void {
  const validated = AuthConfigSchema.parse(config);
  ensureSmcpDir();
  const configFile = getConfigPath();

  atomicWriteFileSync(configFile, JSON.stringify(validated, null, 2), { mode: 0o600 });
}

export function clearAuthConfig(): void {
  const configFile = getConfigPath();
  try {
    fs.unlinkSync(configFile);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

export function getSharesHistory(): ShareHistory {
  ensureSmcpDir();
  const sharesFile = getSharesPath();

  if (!fs.existsSync(sharesFile)) {
    return { shares: [] };
  }

  try {
    const raw = fs.readFileSync(sharesFile, "utf8");
    const parsed = JSON.parse(raw);
    const validated = ShareHistorySchema.safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }
    return { shares: [] };
  } catch {
    return { shares: [] };
  }
}

export function recordShare(record: ShareRecord): void {
  const validatedRecord = ShareRecordSchema.parse(record);
  ensureSmcpDir();

  const history = getSharesHistory();
  const index = history.shares.findIndex((s) => s.name === validatedRecord.name);

  if (index >= 0) {
    history.shares[index] = validatedRecord;
  } else {
    history.shares.push(validatedRecord);
  }

  const validatedHistory = ShareHistorySchema.parse(history);
  const sharesFile = getSharesPath();
  atomicWriteFileSync(sharesFile, JSON.stringify(validatedHistory, null, 2));
}
