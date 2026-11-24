const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function isPrototypePollutionKey(key: unknown): boolean {
  if (typeof key !== "string") {
    return false;
  }
  return PROTOTYPE_POLLUTION_KEYS.has(key);
}

export function isWindowsReservedName(name: string): boolean {
  if (typeof name !== "string") return false;
  const segments = name.replaceAll("\\", "/").split("/").filter(Boolean);
  for (const seg of segments) {
    if (WINDOWS_RESERVED_NAMES.test(seg.trim())) {
      return true;
    }
  }
  return false;
}

export function containsNullByte(input: unknown): boolean {
  if (typeof input !== "string") return false;
  return input.includes("\0");
}

export function stripPrototypePollutionKeys(obj: Record<string, unknown>): void {
  for (const key of PROTOTYPE_POLLUTION_KEYS) {
    if (Object.hasOwn(obj, key)) {
      Reflect.deleteProperty(obj, key);
    }
  }
}
