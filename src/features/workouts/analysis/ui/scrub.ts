/**
 * The shared scrubber: one sample index that the charts, the map and the splits all follow. It lives in a tiny external
 * store so a drag re-renders only the crosshair, the readout and the map marker, never the whole view.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export interface ScrubStore {
  get(): number | null;
  /** Null clears the scrubber. No-op (and no notification) when the value does not change. */
  set(index: number | null): void;
  subscribe(listener: () => void): () => void;
}

export function createScrubStore(): ScrubStore {
  let current: number | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(index) {
      if (index === current) return;
      current = index;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The scrub index, re-rendering on every change. */
export function useScrub(store: ScrubStore): number | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** A value derived from the scrub index; re-renders only when the derived primitive changes. */
export function useScrubSelector<T extends string | number | boolean | null>(store: ScrubStore, select: (index: number | null) => T): T {
  const getSnapshot = useCallback(() => select(store.get()), [store, select]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** The scrub index at most once per animation frame, for heavy consumers (the map). */
export function useScrubFrame(store: ScrubStore): number | null {
  const [value, setValue] = useState<number | null>(store.get());
  const frame = useRef<number | null>(null);
  useEffect(() => {
    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setValue(store.get());
      });
    };
    const unsubscribe = store.subscribe(schedule);
    // Catches a change between the render and the subscription.
    schedule();
    return () => {
      unsubscribe();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [store]);
  return value;
}
