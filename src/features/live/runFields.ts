/**
 * The data fields of a live run, walk, ride or hike: which figures a screen can show, the default layout per sport kind, the pages
 * the fields are shown on, and the repair of a stored layout. Pure: no React, no storage, so it runs under `bun test`. Both the
 * watch-started live screen and the phone Run recorder show their numbers through these ids.
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
  'hrZone',
  'avgHr',
  'maxHr',
  'calories',
  'cadence',
  'steps',
  'stride',
  'elevationGain',
  'altitude',
] as const;

export type RunMetricId = (typeof RUN_METRIC_IDS)[number];

/**
 * A reading per metric in its base unit (seconds, metres, seconds per km, km/h, bpm, kcal, per minute, steps, metres per step, metres);
 * null or absent when unknown. `hrZone` is not read from here: the grid names the zone of `hr` with the person's zone settings.
 */
export type RunMetricValues = Partial<Record<RunMetricId, number | null>>;

/** Metrics that only make sense on foot: the editor does not offer them for a ride or another sport. */
export const FOOT_ONLY_METRICS: readonly RunMetricId[] = ['steps', 'stride'];

export type FieldCount = 4 | 6 | 8 | 10 | 12;

export const FIELD_COUNTS: readonly FieldCount[] = [4, 6, 8, 10, 12];

/** Fields on one page of the grid; more than this go to the next page (swiped sideways). */
export const PAGE_SIZE = 6;

export interface RunLayout {
  /** Unique metric ids, a `FieldCount` of them, in screen order; the first `PAGE_SIZE` on the first page. */
  ids: RunMetricId[];
  /** The first field is shown across the whole width at a large size: readable at arm's length (a pacer holding the phone). */
  big: boolean;
}

/** Run and walk: the first page what a runner glances at, the second the rest of the run (JRG-418: "all the run details"). */
const FOOT_DEFAULT: RunMetricId[] = ['duration', 'distance', 'pace', 'avgPace', 'hr', 'hrZone', 'cadence', 'elevationGain', 'calories', 'avgHr'];
const RIDE_DEFAULT: RunMetricId[] = ['duration', 'distance', 'speed', 'hr', 'calories', 'elevationGain'];

const DEFAULT_IDS: Record<FieldSportKind, RunMetricId[]> = {
  run: FOOT_DEFAULT,
  walk: FOOT_DEFAULT,
  hike: ['duration', 'distance', 'elevationGain', 'hr', 'pace', 'altitude'],
  ride: RIDE_DEFAULT,
  other: ['duration', 'distance', 'hr', 'calories', 'pace', 'cadence'],
};

/**
 * The layout of a sport kind before anything was changed: the first field large. Run and walk get ten on two pages (duration,
 * distance, pace, average pace, heart rate, its zone; cadence, elevation gain, calories, average heart rate), the others four
 * (duration, distance, pace or speed, heart rate). Only a kind without a saved layout gets it: a layout the person saved is read as
 * saved (`normalizeLayout`).
 */
export function defaultLayout(kind: FieldSportKind): RunLayout {
  const count = kind === 'run' || kind === 'walk' ? FOOT_DEFAULT.length : 4;
  return { ids: DEFAULT_IDS[kind].slice(0, count), big: true };
}

function isMetricId(value: unknown): value is RunMetricId {
  return typeof value === 'string' && (RUN_METRIC_IDS as readonly string[]).includes(value);
}

/** The field count a list of `n` ids is cut or filled to: four at least, then the next even number, twelve at most. */
function countFor(n: number): FieldCount {
  if (n <= 4) return 4;
  return Math.min(12, n + (n % 2)) as FieldCount;
}

/**
 * A stored layout of any shape, made valid: unknown and repeated ids go, and the list is filled up (from the sport's defaults, then
 * the remaining metrics) to the next field count, or cut to twelve. A layout saved by an older build (four or six valid fields) comes
 * back unchanged. Anything unusable is the sport's default layout.
 */
export function normalizeLayout(raw: unknown, kind: FieldSportKind): RunLayout {
  if (typeof raw !== 'object' || raw === null) return defaultLayout(kind);
  const source = raw as { ids?: unknown; big?: unknown };
  if (!Array.isArray(source.ids)) return defaultLayout(kind);
  const ids: RunMetricId[] = [];
  for (const id of source.ids) if (isMetricId(id) && !ids.includes(id)) ids.push(id);
  if (ids.length === 0) return defaultLayout(kind);
  const count = countFor(ids.length);
  for (const id of [...DEFAULT_IDS[kind], ...RUN_METRIC_IDS]) {
    if (ids.length >= count) break;
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids: ids.slice(0, count), big: source.big === true };
}

/** The layout with `count` fields: cut from the end, or filled up with metrics not yet shown and not in `exclude` (the screen has none of them). */
export function withCount(layout: RunLayout, count: FieldCount, exclude: readonly RunMetricId[] = []): RunLayout {
  const ids = layout.ids.slice(0, count);
  for (const id of RUN_METRIC_IDS) {
    if (ids.length >= count) break;
    if (!ids.includes(id) && !exclude.includes(id)) ids.push(id);
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
 * How many fields each row of the first page holds: pairs normally; with a large first field the rest fill rows of three, so
 * four fields are one wide field and a row of three, six are one wide field and rows of three and two.
 */
export function rowSizes(layout: RunLayout): number[] {
  const count = Math.min(layout.ids.length, PAGE_SIZE);
  const rest = count - (layout.big ? 1 : 0);
  const rows: number[] = layout.big ? [1] : [];
  const width = layout.big ? 3 : 2;
  for (let left = rest; left > 0; left -= width) rows.push(Math.min(width, left));
  return rows;
}

export interface GridPage {
  /** Index in `ids` of the page's first field. */
  start: number;
  /** Fields per row, top to bottom. */
  rows: number[];
}

/**
 * The pages of the grid: the first `PAGE_SIZE` fields as `rowSizes` lays them out, every further `PAGE_SIZE` on a page of its own in
 * pairs (large figures, read at a glance after a swipe). Four or six fields are one page, as before pages existed.
 */
export function gridPages(layout: RunLayout): GridPage[] {
  const pages: GridPage[] = [{ start: 0, rows: rowSizes(layout) }];
  for (let start = PAGE_SIZE; start < layout.ids.length; start += PAGE_SIZE) {
    const count = Math.min(PAGE_SIZE, layout.ids.length - start);
    const rows: number[] = [];
    for (let left = count; left > 0; left -= 2) rows.push(Math.min(2, left));
    pages.push({ start, rows });
  }
  return pages;
}

/** Metres per step from a distance and the steps counted over the same stretch; null before 20 steps and 10 m (the ratio would swing). */
export function strideLength(distanceM: number | null, steps: number | null): number | null {
  if (distanceM === null || steps === null || steps < 20 || distanceM < 10) return null;
  return distanceM / steps;
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
