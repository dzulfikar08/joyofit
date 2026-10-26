/**
 * The data-field layout of a live workout per sport kind, in the key-value store: read synchronously (the screen needs it on its first
 * frame), written on every change, with a subscription for `useSyncExternalStore`. The repair rules are in `runFields.ts`.
 */
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { defaultLayout, normalizeLayout, type FieldSportKind, type RunLayout, type RunMetricId } from './runFields';

const KEY = 'joyofit.live.fields';

let stored: Partial<Record<FieldSportKind, RunLayout>> | null = null;
const cache = new Map<FieldSportKind, RunLayout>();
const listeners = new Set<() => void>();

function readAll(): Partial<Record<FieldSportKind, unknown>> {
  try {
    const text = Storage.getItemSync(KEY);
    const parsed: unknown = text ? JSON.parse(text) : null;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<Record<FieldSportKind, unknown>>) : {};
  } catch {
    return {};
  }
}

function layoutOf(kind: FieldSportKind): RunLayout {
  const cached = cache.get(kind);
  if (cached) return cached;
  const raw = (stored ?? readAll())[kind];
  const layout = raw === undefined ? defaultLayout(kind) : normalizeLayout(raw, kind);
  cache.set(kind, layout);
  return layout;
}

export const runLayoutStore = {
  get: layoutOf,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** `exclude`: metrics the editing screen can never read; the repair never fills a slot with one of them. */
  set(kind: FieldSportKind, layout: RunLayout, exclude: readonly RunMetricId[] = []): void {
    const next = normalizeLayout(layout, kind, exclude);
    cache.set(kind, next);
    stored = { ...(stored ?? (readAll() as Partial<Record<FieldSportKind, RunLayout>>)), [kind]: next };
    try {
      Storage.setItemSync(KEY, JSON.stringify(stored));
    } catch {
      // The change still applies for this session.
    }
    listeners.forEach((listener) => listener());
  },
};

/** The layout of `kind` and a setter (`exclude` as for `runLayoutStore.set`); it follows changes made from any screen. */
export function useRunLayout(kind: FieldSportKind): [RunLayout, (layout: RunLayout, exclude?: readonly RunMetricId[]) => void] {
  const layout = useSyncExternalStore(
    runLayoutStore.subscribe,
    () => layoutOf(kind),
    () => layoutOf(kind),
  );
  return [layout, (next, exclude) => runLayoutStore.set(kind, next, exclude)];
}
