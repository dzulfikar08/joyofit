/**
 * The data fields of a live run, walk, ride or hike: which figures a screen can show, the default four or six per sport kind, and
 * the repair of a stored layout. Pure: no React, no storage, so it runs under `bun test`. Both the watch-started live screen and the
 * phone Run recorder show their numbers through these ids.
 */

export type FieldSportKind = 'run' | 'walk' | 'ride' | 'hike' | 'other';

export const FIELD_SPORT_KINDS: readonly FieldSportKind[] = ['run', 'walk', 'ride', 'hike', 'other'];

export const RUN_METRIC_IDS = [
  'duration',
  'distance',
  'pace',
  'avgPace',
  'speed',
  'hr',
  'calories',
  'cadence',
  'elevationGain',
  'altitude',
] as const;

export type RunMetricId = (typeof RUN_METRIC_IDS)[number];

/** A reading per metric in its base unit (seconds, metres, seconds per km, km/h, bpm, kcal, per minute, metres); null or absent when unknown. */
export type RunMetricValues = Partial<Record<RunMetricId, number | null>>;

export type FieldCount = 4 | 6;

export interface RunLayout {
  /** Unique metric ids, four or six of them, in screen order. */
  ids: RunMetricId[];
  /** The first field is shown across the whole width at a large size: readable at arm's length (a pacer holding the phone). */
  big: boolean;
}

const FOOT_DEFAULT: RunMetricId[] = ['duration', 'distance', 'pace', 'hr', 'elevationGain', 'calories'];
const RIDE_DEFAULT: RunMetricId[] = ['duration', 'distance', 'speed', 'hr', 'calories', 'elevationGain'];

const DEFAULT_IDS: Record<FieldSportKind, RunMetricId[]> = {
  run: FOOT_DEFAULT,
  walk: FOOT_DEFAULT,
  hike: ['duration', 'distance', 'elevationGain', 'hr', 'pace', 'altitude'],
  ride: RIDE_DEFAULT,
  other: ['duration', 'distance', 'hr', 'calories', 'pace', 'cadence'],
};

/**
 * The layout of a sport kind before anything was changed: the first field large. Run and walk get six (duration, distance, pace, heart
 * rate, elevation gain, calories: the climb was asked for, JRG-418), the others four (duration, distance, pace or speed, heart rate).
 */
export function defaultLayout(kind: FieldSportKind): RunLayout {
  const count = kind === 'run' || kind === 'walk' ? 6 : 4;
  return { ids: DEFAULT_IDS[kind].slice(0, count), big: true };
}

function isMetricId(value: unknown): value is RunMetricId {
  return typeof value === 'string' && (RUN_METRIC_IDS as readonly string[]).includes(value);
}

/**
 * A stored layout of any shape, made valid: unknown and repeated ids go, and the list is cut or filled up (from the sport's defaults,
 * then the remaining metrics) to the nearer of four or six. Anything unusable is the sport's default layout.
 */
export function normalizeLayout(raw: unknown, kind: FieldSportKind): RunLayout {
  if (typeof raw !== 'object' || raw === null) return defaultLayout(kind);
  const source = raw as { ids?: unknown; big?: unknown };
  if (!Array.isArray(source.ids)) return defaultLayout(kind);
  const ids: RunMetricId[] = [];
  for (const id of source.ids) if (isMetricId(id) && !ids.includes(id)) ids.push(id);
  if (ids.length === 0) return defaultLayout(kind);
  const count: FieldCount = ids.length >= 5 ? 6 : 4;
  for (const id of [...DEFAULT_IDS[kind], ...RUN_METRIC_IDS]) {
    if (ids.length >= count) break;
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids: ids.slice(0, count), big: source.big === true };
}

/** The layout with four or six fields: cut from the end, or filled up with metrics not yet shown. */
export function withCount(layout: RunLayout, count: FieldCount): RunLayout {
  const ids = layout.ids.slice(0, count);
  for (const id of RUN_METRIC_IDS) {
    if (ids.length >= count) break;
    if (!ids.includes(id)) ids.push(id);
  }
  return { ...layout, ids };
}

/** The slot `slot` shows `id`; when `id` was shown elsewhere the two swap, so every metric stays once. */
export function assignMetric(layout: RunLayout, slot: number, id: RunMetricId): RunLayout {
  if (slot < 0 || slot >= layout.ids.length) return layout;
  const ids = [...layout.ids];
  const other = ids.indexOf(id);
  if (other >= 0) ids[other] = ids[slot];
  ids[slot] = id;
  return { ...layout, ids };
}

/**
 * How many fields each row of the grid holds: pairs normally; with a large first field the rest fill rows of three, so
 * four fields are one wide field and a row of three, six are one wide field and rows of three and two.
 */
export function rowSizes(layout: RunLayout): number[] {
  const rest = layout.ids.length - (layout.big ? 1 : 0);
  const rows: number[] = layout.big ? [1] : [];
  const width = layout.big ? 3 : 2;
  for (let left = rest; left > 0; left -= width) rows.push(Math.min(width, left));
  return rows;
}

/** Run, walk and hike are on foot: cadence is steps per minute there, revolutions per minute elsewhere. */
export function footKind(kind: FieldSportKind | null): boolean {
  return kind === 'run' || kind === 'walk' || kind === 'hike';
}

/** Speed in km/h for a pace in seconds per km; null for no pace. */
export function speedFromPace(paceSPerKm: number | null): number | null {
  return paceSPerKm !== null && paceSPerKm > 0 ? 3600 / paceSPerKm : null;
}

/** Average pace of a run so far: seconds per km from the moving time and the distance, null before 10 m (the figure would swing wildly). */
export function averagePace(durationS: number | null, distanceM: number | null): number | null {
  if (durationS === null || distanceM === null || distanceM < 10 || durationS <= 0) return null;
  return durationS / (distanceM / 1000);
}
