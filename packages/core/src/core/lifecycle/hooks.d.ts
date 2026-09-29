import type { HookFn, HookOptions, LifecycleEvent, LifecycleEventMap } from "./types.ts";
/**
 * Registers a lifecycle hook for the specified event.
 * Returns an unsubscribe function to remove the hook.
 */
export declare function registerHook<K extends keyof LifecycleEventMap>(event: K, fn: HookFn<LifecycleEventMap[K]>, options?: HookOptions): () => void;
export declare function registerHook<T = any>(event: LifecycleEvent | string, fn: HookFn<T>, options?: HookOptions): () => void;
/**
 * Alias for registerHook.
 */
export declare const on: typeof registerHook;
/**
 * Unregisters a lifecycle hook by function reference.
 * Returns true if removed, false otherwise.
 */
export declare function unregisterHook(event: LifecycleEvent | string, fn: HookFn): boolean;
/**
 * Triggers all hooks registered for an event in sorted priority order (ascending).
 * Awaiting each hook promise. If a hook throws, execution halts and the error propagates.
 */
export declare function triggerHook<K extends keyof LifecycleEventMap>(event: K, context: LifecycleEventMap[K]): Promise<void>;
export declare function triggerHook<T = any>(event: string, context: T): Promise<void>;
/**
 * Clears all registered hooks.
 */
export declare function resetHooks(): void;
