const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isPrototypePollutionKey(key: unknown): boolean {
  if (typeof key !== "string") {
    return false;
  }
  return PROTOTYPE_POLLUTION_KEYS.has(key);
}
