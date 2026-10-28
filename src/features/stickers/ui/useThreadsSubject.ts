import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';

import { listWorkouts, type WorkoutRow } from '@/db/queries';
import type { RideAnalysis } from '@/features/cycling/types';
import { getWorkoutDevice, listWatches, type WatchRow } from '@/features/device/watches';
import type { PersonalRecord } from '@/features/strength/calc';
import type { Catalog } from '@/features/strength/catalog';
import { listStrengthWorkoutsBetween } from '@/features/strength/store';
import type { StrengthWorkout } from '@/features/strength/types';
import { modelOfBluetoothName } from '@/features/device/watchName';
import { shownName } from '@/features/device/shownName';
import { modelName } from '@/features/strava/device';
import { sportKind } from '@/features/workouts/analysis/sport';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import type { RoutePoint, WorkoutSummary } from '@/features/workouts/summary';
import { useLocale } from '@/i18n';

import { buildThreadsRun, buildThreadsStrength, weeklyContext, type ThreadsContext } from '../data/threads';
import type { StickerSubject } from '../subject';

/** Days the context slide looks back (four weekly windows). */
const CONTEXT_DAYS = 28;
const DAY_MS = 86_400_000;
/** What `importedFrom` holds for a FIT file that names no manufacturer: not a device. */
const FIT_FILE = 'FIT file';

/** What the sheet needs from the database, loaded while it is open. */
interface Loaded {
  /** `workouts.start` of the workout it was loaded for, so a result is never used for another workout. */
  start: number;
  context: ThreadsContext | null;
  deviceName: string | null;
}

/** The model name of the watch that recorded a row (`device` holds its address), not the person's alias for it. */
function watchModel(watches: readonly WatchRow[], address: string | null): string | null {
  const watch = address === null ? undefined : watches.find((w) => w.address === address);
  if (!watch) return null;
  return shownName(modelOfBluetoothName(watch.name) || watch.productModel?.trim() || modelName(watch.name) || null);
}

export interface ThreadsRunArgs {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  route: readonly RoutePoint[];
  analysis: WorkoutAnalysis | null;
  /** The cycling metrics (`useRideData`); null for everything that is not a ride. */
  ride: RideAnalysis | null;
  gearLine: string | null;
}

async function loadRun(db: SQLiteDatabase, workout: WorkoutRow, summary: WorkoutSummary, analysis: WorkoutAnalysis | null): Promise<Loaded> {
  try {
    const [rows, watches, address] = await Promise.all([listWorkouts(db), listWatches(db), getWorkoutDevice(db, workout.id)]);
    const deviceName = summary.importedFrom
      ? summary.importedFrom === FIT_FILE
        ? null
        : summary.importedFrom
      : summary.source === 'phone'
        ? null
        : watchModel(watches, address);
    const context = weeklyContext({
      workouts: rows,
      strength: [],
      anchorSec: workout.end > workout.start ? workout.end : workout.start + workout.duration,
      kind: analysis?.sport.kind ?? sportKind(workout.sportName, summary.kind),
    });
    return { start: workout.start, context, deviceName };
  } catch {
    return { start: workout.start, context: null, deviceName: null };
  }
}

/**
 * The Threads carousel subject of a workout, or null until the sheet has been opened once and its data (the watch that recorded
 * it, the last four weeks) is read. `open` is whether the Threads sheet is showing: the queries run each time it opens, never
 * while it is closed.
 */
export function useThreadsRunSubject(args: ThreadsRunArgs, open: boolean): StickerSubject | null {
  const db = useSQLiteContext();
  const locale = useLocale();
  const { workout, summary, route, analysis, ride, gearLine } = args;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadRun(db, workout, summary, analysis).then((next) => {
      if (live) setLoaded(next);
    });
    return () => {
      live = false;
    };
  }, [db, open, workout, summary, analysis]);

  return useMemo(() => {
    if (loaded === null || loaded.start !== workout.start) return null;
    return buildThreadsRun({ workout, summary, analysis, route, gearLine, ride, deviceName: loaded.deviceName, context: loaded.context }, locale);
  }, [loaded, workout, summary, analysis, route, gearLine, ride, locale]);
}

export interface ThreadsStrengthArgs {
  workout: StrengthWorkout;
  catalog: Catalog;
  records: readonly PersonalRecord[];
}

async function loadStrength(db: SQLiteDatabase, workout: StrengthWorkout): Promise<Loaded> {
  const start = workout.startedAt;
  try {
    const anchorSec = Math.floor(workout.endedAt / 1000);
    // The range is wider than the four windows on both sides: `weeklyContext` drops what falls outside them.
    const [rows, watches, strength] = await Promise.all([
      listWorkouts(db),
      listWatches(db),
      listStrengthWorkoutsBetween(db, anchorSec * 1000 - (CONTEXT_DAYS + 1) * DAY_MS, anchorSec * 1000 + DAY_MS),
    ]);
    const row = workout.workoutStart === null ? undefined : rows.find((r) => r.start === workout.workoutStart);
    const deviceName = row ? watchModel(watches, await getWorkoutDevice(db, row.id)) : null;
    return { start, context: weeklyContext({ workouts: rows, strength, anchorSec, kind: 'strength' }), deviceName };
  } catch {
    return { start, context: null, deviceName: null };
  }
}

/** The Threads carousel subject of a strength workout; same loading rules as `useThreadsRunSubject`. */
export function useThreadsStrengthSubject(args: ThreadsStrengthArgs, open: boolean): StickerSubject | null {
  const db = useSQLiteContext();
  const locale = useLocale();
  const { workout, catalog, records } = args;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadStrength(db, workout).then((next) => {
      if (live) setLoaded(next);
    });
    return () => {
      live = false;
    };
  }, [db, open, workout]);

  return useMemo(() => {
    if (loaded === null || loaded.start !== workout.startedAt) return null;
    return buildThreadsStrength({ workout, catalog, records, resolveMuscles: catalog.muscles, deviceName: loaded.deviceName, context: loaded.context }, locale);
  }, [loaded, workout, catalog, records, locale]);
}
