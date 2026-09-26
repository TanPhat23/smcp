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

export function getSmcpDir(): string {
  if (process.env.SMCP_DIR && process.env.SMCP_DIR.trim().length > 0) {
    return path.resolve(process.env.SMCP_DIR.trim());
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

  if (process.env.GITHUB_TOKEN) {
    return {
      ...saved,
      githubToken: process.env.GITHUB_TOKEN
    };
  }

  return saved;
}

export function saveAuthConfig(config: AuthConfig): void {
  const validated = AuthConfigSchema.parse(config);
  ensureSmcpDir();
  const configFile = getConfigPath();

  fs.writeFileSync(configFile, JSON.stringify(validated, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(configFile, 0o600);
  } catch {
    // Non-POSIX platforms (e.g. Windows) may not support chmod
  }
}

export function clearAuthConfig(): void {
  const configFile = getConfigPath();
  if (fs.existsSync(configFile)) {
    try {
      fs.unlinkSync(configFile);
    } catch {
      // Ignore if unlinking fails or already removed
    }
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
  fs.writeFileSync(sharesFile, JSON.stringify(validatedHistory, null, 2), "utf8");
}
