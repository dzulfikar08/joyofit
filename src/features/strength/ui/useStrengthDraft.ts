import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { restLeftSec } from '../draft';
import { saveDraft } from '../store';
import type { StrengthDraft } from '../types';

const SAVE_DELAY_MS = 400;

/** Current time in ms, refreshed every second while `active`. Only the small clock components use it, so the list does not redraw each second. */
export function useTicker(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // Refresh at once on activation, after the first paint rather than in the effect body.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active, intervalMs]);
  return now;
}

export interface DraftHandle {
  /** The draft, null until `start` was called. */
  draft: StrengthDraft | null;
  /** The newest draft, readable inside event handlers without waiting for a render. */
  current: () => StrengthDraft | null;
  /** Sets the first draft. A rest timer that already ended while the app was closed is dropped. */
  start: (draft: StrengthDraft) => void;
  /** Replaces the draft with the result of a reducer of `draft.ts`. */
  commit: (next: StrengthDraft) => void;
  update: (change: (draft: StrengthDraft) => StrengthDraft) => void;
  /** Writes the pending change now. */
  flush: () => Promise<void>;
  /** Stops saving for good (after finishing or discarding: a late flush must not bring the draft back). */
  close: () => void;
}

/**
 * The workout in progress: React state fed by the pure reducers of `draft.ts`, saved to the device ~400 ms after the last change and
 * at once when the app goes to the background or the screen closes. `persist` is false when a finished workout is being edited.
 */
export function useStrengthDraft(persist: boolean): DraftHandle {
  const db = useSQLiteContext();
  const [draft, setDraft] = useState<StrengthDraft | null>(null);
  const ref = useRef<StrengthDraft | null>(null);
  const dirty = useRef(false);
  const closed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    clearTimeout(timer.current ?? undefined);
    timer.current = null;
    if (!persist || closed.current || !dirty.current || !ref.current) return;
    dirty.current = false;
    await saveDraft(db, ref.current);
  }, [db, persist]);

  const commit = useCallback(
    (next: StrengthDraft) => {
      if (closed.current) return;
      ref.current = next;
      setDraft(next);
      dirty.current = true;
      if (!persist) return;
      clearTimeout(timer.current ?? undefined);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush, persist],
  );

  const start = useCallback(
    (initial: StrengthDraft) => {
      const rest = initial.rest && restLeftSec({ rest: initial.rest, pausedAt: initial.pausedAt }, Date.now()) === null ? null : initial.rest;
      commit(rest === initial.rest ? initial : { ...initial, rest });
    },
    [commit],
  );

  const update = useCallback(
    (change: (d: StrengthDraft) => StrengthDraft) => {
      if (ref.current) commit(change(ref.current));
    },
    [commit],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flush();
    });
    return () => {
      sub.remove();
      void flush();
    };
  }, [flush]);

  const close = useCallback(() => {
    closed.current = true;
    clearTimeout(timer.current ?? undefined);
    timer.current = null;
  }, []);

  const current = useCallback(() => ref.current, []);

  return { draft, current, start, commit, update, flush, close };
}
