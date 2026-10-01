import {
  InstalledPackRecordSchema,
  InstalledPacksRegistrySchema,
  type InstalledPackRecord,
  type InstalledPacksRegistry
} from "../../types/index.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { getStorageProvider } from "./storage/index.ts";

export type { InstalledPackRecord, InstalledPacksRegistry };

export function getInstalledPacks(): InstalledPacksRegistry {
  try {
    const raw = getStorageProvider().getItem("installed");
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    const validated = InstalledPacksRegistrySchema.safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }
    return {};
  } catch {
    return {};
  }
}

export function getInstalledPack(name: string): InstalledPackRecord | undefined {
  if (!name || typeof name !== "string" || isPrototypePollutionKey(name)) {
    return undefined;
  }
  const registry = getInstalledPacks();
  return registry[name];
}

export function recordInstalledPack(record: InstalledPackRecord): void {
  const validatedRecord = InstalledPackRecordSchema.parse(record);
  if (isPrototypePollutionKey(validatedRecord.name)) {
    throw new Error(`Invalid pack name: ${validatedRecord.name}`);
  }

  const registry = getInstalledPacks();
  registry[validatedRecord.name] = validatedRecord;

  const validatedRegistry = InstalledPacksRegistrySchema.parse(registry);
  getStorageProvider().setItem("installed", JSON.stringify(validatedRegistry, null, 2));
}

export function removeInstalledPack(packName: string): boolean {
  if (!packName || typeof packName !== "string" || isPrototypePollutionKey(packName)) {
    return false;
  }

  const registry = getInstalledPacks();
  if (!registry[packName]) {
    return false;
  }

  delete registry[packName];
  const validatedRegistry = InstalledPacksRegistrySchema.parse(registry);
  getStorageProvider().setItem("installed", JSON.stringify(validatedRegistry, null, 2));
  return true;
}
