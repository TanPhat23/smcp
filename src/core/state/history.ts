import fs from "node:fs";
import {
  ShareHistorySchema,
  ShareRecordSchema,
  type ShareHistory,
  type ShareRecord
} from "../../types/index.ts";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import { ensureSmcpDir, getSharesPath } from "./paths.ts";

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
