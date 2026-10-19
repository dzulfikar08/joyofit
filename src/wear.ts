import { Platform } from 'react-native';

import RawHuaweiWear from '../modules/huawei-wear';

export * from '../modules/huawei-wear';

const callErrorListeners = new Set<(error: unknown) => void>();

/**
 * Hears every error a call into the native module throws or rejects with, without handling it (the caller still gets it). The
 * database repair listens here: the native writer (Kotlin, its own SQLite) is the one that meets a damaged file first, and its
 * error reaches JS only as the rejection of whatever call was running.
 */
export function onNativeCallError(listener: (error: unknown) => void): () => void {
  callErrorListeners.add(listener);
  return () => {
    callErrorListeners.delete(listener);
  };
}

function announce(error: unknown): void {
  for (const listener of callErrorListeners) {
    try {
      listener(error);
    } catch {
      // A listener must never change what the caller of the native function sees.
    }
  }
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'then') === 'function';

/** The event-emitter methods of the module: not calls into the database, and `useEventListener` wants them as they are. */
const EMITTER: Record<string, true> = { addListener: true, removeListener: true, removeAllListeners: true, emit: true, listenerCount: true };

type NativeFunction = (...args: unknown[]) => unknown;

const guarded = new WeakMap<NativeFunction, NativeFunction>();

function guard(target: object, fn: NativeFunction): NativeFunction {
  const known = guarded.get(fn);
  if (known) return known;
  const wrapper: NativeFunction = (...args) => {
    let result: unknown;
    try {
      result = fn.apply(target, args);
    } catch (e) {
      announce(e);
      throw e;
    }
    if (!isThenable(result)) return result;
    return result.then(undefined, (e: unknown) => {
      announce(e);
      throw e;
    });
  };
  guarded.set(fn, wrapper);
  return wrapper;
}

/**
 * The native module. On Android every call of it is watched by `onNativeCallError` (the Kotlin writer is where the corruption
 * shows first). On iOS it is the module itself, untouched: a proxy around a native module object is not what the iOS runtime
 * hands out, and the repair has no iOS writer to hear from.
 */
export const HuaweiWear: typeof RawHuaweiWear = Platform.OS !== 'android' ? RawHuaweiWear : new Proxy(RawHuaweiWear, {
  get(target, property) {
    const value: unknown = Reflect.get(target, property, target);
    if (typeof value !== 'function') return value;
    // The emitter methods go through untouched but always on the module itself: a native `addListener` looks for the module's
    // native state in `this`, and `this` is the proxy when the caller wrote `HuaweiWear.addListener(...)`.
    if (typeof property === 'string' && property in EMITTER) return (value as NativeFunction).bind(target);
    return guard(target, value as NativeFunction);
  },
});

/**
 * OTA bundles can run on older installed binaries whose native module lacks newer functions.
 * Call sites for functions added after a release MUST gate on this.
 */
export function hasNative(name: string): boolean {
  try {
    return typeof (HuaweiWear as unknown as Record<string, unknown>)[name] === 'function';
  } catch {
    return false;
  }
}

/** Closes and reopens the native connection to `joyofit.db` (`releaseDatabase` / `resumeDatabase` of the Android module). */
export interface NativeDatabaseControl {
  /** Closes the native connection and keeps it closed (native reads and writes fail with ERR_STORAGE) until `resume`; waits for a running transaction. */
  release(): Promise<void>;
  resume(): Promise<void>;
}

/** The control, or null on a binary that does not have it (iOS, and Android builds older than the shared-SQLite change). */
export function nativeDatabaseControl(): NativeDatabaseControl | null {
  if (!hasNative('releaseDatabase') || !hasNative('resumeDatabase')) return null;
  return { release: () => HuaweiWear.releaseDatabase(), resume: () => HuaweiWear.resumeDatabase() };
}
