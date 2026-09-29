import fs from "node:fs";
import path from "node:path";
import { atomicWriteFileSync } from "../../../utils/fs.ts";
import { isPrototypePollutionKey } from "../../../utils/security.ts";
import { ensureSmcpDir, getConfigPath, getSharesPath, getSmcpDir } from "../paths.ts";
import type { StorageProvider } from "./types.ts";

export class FileStorageProvider implements StorageProvider {
  readonly name = "file";

  private resolvePath(key: string): string {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new Error("Invalid storage key: must be a non-empty string");
    }

    const cleanKey = key.trim();
    if (
      isPrototypePollutionKey(cleanKey) ||
      !/^[a-zA-Z0-9_-]+$/.test(cleanKey)
    ) {
      throw new Error(`Invalid storage key: '${key}'`);
    }

    const smcpDir = getSmcpDir();
    let filePath: string;

    if (cleanKey === "config") {
      filePath = getConfigPath();
    } else if (cleanKey === "shares") {
      filePath = getSharesPath();
    } else {
      filePath = path.join(smcpDir, `${cleanKey}.json`);
    }

    const rel = path.relative(smcpDir, filePath);
    if (rel.startsWith("..") || path.isAbsolute(rel) || rel.includes(path.sep)) {
      throw new Error(`Invalid storage key: '${key}'`);
    }

    return filePath;
  }

  getItem(key: string): string | null {
    const filePath = this.resolvePath(key);
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return fs.readFileSync(filePath, "utf8");
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  setItem(key: string, value: string): void {
    if (typeof value !== "string") {
      throw new Error("Storage value must be a string");
    }
    ensureSmcpDir();
    const filePath = this.resolvePath(key);
    atomicWriteFileSync(filePath, value, { mode: 0o600 });
  }

  removeItem(key: string): void {
    const filePath = this.resolvePath(key);
    try {
      fs.unlinkSync(filePath);
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
}
