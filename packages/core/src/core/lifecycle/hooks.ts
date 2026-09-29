import { isPrototypePollutionKey } from "../../utils/security.ts";
import type {
  HookFn,
  HookOptions,
  LifecycleEvent,
  LifecycleEventMap
} from "./types.ts";

interface RegisteredHookEntry {
  fn: HookFn<any>;
  priority: number;
  order: number;
}

const hooksMap = new Map<string, RegisteredHookEntry[]>();
let hookOrderCounter = 0;

function validateHookEvent(event: unknown): string {
  if (typeof event !== "string" || !event.trim()) {
    throw new Error("Invalid hook event: must be a non-empty string");
  }
  const clean = event.trim();
  if (isPrototypePollutionKey(clean)) {
    throw new Error(`Invalid hook event: prototype pollution key '${clean}' is rejected`);
  }
  return clean;
}

/**
 * Registers a lifecycle hook for the specified event.
 * Returns an unsubscribe function to remove the hook.
 */
export function registerHook<K extends keyof LifecycleEventMap>(
  event: K,
  fn: HookFn<LifecycleEventMap[K]>,
  options?: HookOptions
): () => void;
export function registerHook<T = any>(
  event: LifecycleEvent | string,
  fn: HookFn<T>,
  options?: HookOptions
): () => void;
export function registerHook<T = any>(
  event: LifecycleEvent | string,
  fn: HookFn<T>,
  options?: HookOptions
): () => void {
  const cleanEvent = validateHookEvent(event);
  if (typeof fn !== "function") {
    throw new Error("Invalid hook function: must be a function");
  }

  const priority =
    typeof options?.priority === "number" && !Number.isNaN(options.priority)
      ? options.priority
      : 100;

  const entry: RegisteredHookEntry = {
    fn,
    priority,
    order: ++hookOrderCounter
  };

  let list = hooksMap.get(cleanEvent);
  if (!list) {
    list = [];
    hooksMap.set(cleanEvent, list);
  }
  list.push(entry);

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    const currentList = hooksMap.get(cleanEvent);
    if (!currentList) return;
    const idx = currentList.indexOf(entry);
    if (idx !== -1) {
      currentList.splice(idx, 1);
    }
    if (currentList.length === 0) {
      hooksMap.delete(cleanEvent);
    }
  };
}

/**
 * Alias for registerHook.
 */
export const on: typeof registerHook = registerHook;

/**
 * Unregisters a lifecycle hook by function reference.
 * Returns true if removed, false otherwise.
 */
export function unregisterHook(event: LifecycleEvent | string, fn: HookFn): boolean {
  if (!event || typeof event !== "string") {
    return false;
  }
  const cleanEvent = event.trim();
  if (!cleanEvent || isPrototypePollutionKey(cleanEvent) || typeof fn !== "function") {
    return false;
  }

  const currentList = hooksMap.get(cleanEvent);
  if (!currentList || currentList.length === 0) {
    return false;
  }

  const idx = currentList.findIndex((h) => h.fn === fn);
  if (idx === -1) {
    return false;
  }

  currentList.splice(idx, 1);
  if (currentList.length === 0) {
    hooksMap.delete(cleanEvent);
  }
  return true;
}

/**
 * Triggers all hooks registered for an event in sorted priority order (ascending).
 * Awaiting each hook promise. If a hook throws, execution halts and the error propagates.
 */
export async function triggerHook<K extends keyof LifecycleEventMap>(
  event: K,
  context: LifecycleEventMap[K]
): Promise<void>;
export async function triggerHook<T = any>(
  event: string,
  context: T
): Promise<void>;
export async function triggerHook<T = any>(
  event: string,
  context: T
): Promise<void> {
  const cleanEvent = validateHookEvent(event);
  const list = hooksMap.get(cleanEvent);
  if (!list || list.length === 0) {
    return;
  }

  // Sort ascending by priority (lower number runs earlier), then by order
  const sorted = [...list].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.order - b.order;
  });

  for (const hook of sorted) {
    await hook.fn(context);
  }
}

/**
 * Clears all registered hooks.
 */
export function resetHooks(): void {
  hooksMap.clear();
  hookOrderCounter = 0;
}
