import {
  ShareHistorySchema,
  ShareRecordSchema,
  type ShareHistory,
  type ShareRecord
} from "../../types/index.ts";
import { getStorageProvider } from "./storage/index.ts";

export function getSharesHistory(): ShareHistory {
  try {
    const raw = getStorageProvider().getItem("shares");
    if (!raw) {
      return { shares: [] };
    }
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

  const history = getSharesHistory();
  const index = history.shares.findIndex((s) => s.name === validatedRecord.name);

  if (index >= 0) {
    history.shares[index] = validatedRecord;
  } else {
    history.shares.push(validatedRecord);
  }

  const validatedHistory = ShareHistorySchema.parse(history);
  getStorageProvider().setItem("shares", JSON.stringify(validatedHistory, null, 2));
}
