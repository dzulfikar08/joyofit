/**
 * Which numbers of a workout mean something for its sport family, which template family draws it, and which card the share
 * sheet opens on. `buildRunSubject` drops every `run.*` field its family does not use, so every template (the running ones
 * too) simply hides it: no pace on a gym session, no kilometres on a yoga class, no speed on a badminton match.
 */
import type { SportCategory } from '@/features/workouts/sportCategory';

import type { JsonObject, StickerKind } from '../subject';

/**
 * Groups of `run.*` fields whose meaning depends on the sport. Time, heart rate, calories, heart rate zones, strain and gear
 * mean the same for every sport and are always kept.
 */
export type SportMetric = 'distance' | 'pace' | 'swimPace' | 'speed' | 'climb' | 'cadence' | 'power' | 'steps' | 'jumps' | 'route' | 'splits' | 'swim' | 'lifts' | 'records';

/** The `run.*` keys of each metric. */
export const METRIC_FIELDS: Readonly<Record<SportMetric, readonly string[]>> = {
  distance: ['distanceM'],
  pace: ['paceSecKm'],
  swimPace: ['pace100Sec'],
  speed: ['speedKmh'],
  climb: ['elevGainM', 'altSeries'],
  cadence: ['cadence'],
  power: ['power'],
  steps: ['steps'],
  jumps: ['jumps'],
  route: ['route'],
  splits: ['splitKmh', 'splitLabels', 'splitFastest', 'paceSeries'],
  swim: ['laps', 'strokes', 'swolf', 'poolM', 'strokeRate'],
  lifts: ['volumeKg', 'sets', 'reps', 'exercises'],
  records: ['prLabel', 'prTime', 'prCount'],
};

/**
 * What each family shows. A step count is noise on a bike, in the pool and under a barbell; a watch's step-derived distance is
 * noise in a gym, a HIIT class or on a yoga mat; a pace only reads on foot (per km) and in the pool (per 100 m). A court
 * sport keeps the distance covered (a football match) and the steps, never a pace or a speed. A sport outside every family
 * (golf, paddling, skating) keeps its distance and climb but no speed: a round of golf at 2.6 km/h says nothing.
 */
export const SPORT_METRICS: Readonly<Record<SportCategory, readonly SportMetric[]>> = {
  run: ['distance', 'pace', 'climb', 'cadence', 'power', 'steps', 'route', 'splits', 'records'],
  walk: ['distance', 'pace', 'climb', 'cadence', 'steps', 'route', 'splits', 'records'],
  ride: ['distance', 'speed', 'climb', 'cadence', 'power', 'route', 'splits'],
  swim: ['distance', 'swimPace', 'route', 'swim'],
  gym: ['lifts'],
  cardio: ['jumps'],
  flow: [],
  court: ['distance', 'steps'],
  other: ['distance', 'climb', 'steps', 'route'],
};

export function metricApplies(category: SportCategory, metric: SportMetric): boolean {
  return SPORT_METRICS[category].includes(metric);
}

/** Removes from `run` every field whose metric the family does not use. */
export function dropInapplicable(run: JsonObject, category: SportCategory): void {
  for (const [metric, fields] of Object.entries(METRIC_FIELDS) as [SportMetric, readonly string[]][]) {
    if (metricApplies(category, metric)) continue;
    for (const field of fields) delete run[field];
  }
}

/** The template family of a sport family; `run` and `other` draw on the `run` cards alone. */
export const CATEGORY_KIND: Readonly<Record<SportCategory, StickerKind | null>> = {
  run: null,
  walk: 'walk',
  ride: 'ride',
  swim: 'swim',
  gym: 'gym',
  cardio: 'cardio',
  flow: 'flow',
  court: 'court',
  other: null,
};

/** The card the share sheet opens on (`offer.ts` group key: the template id without its canvas). */
export const DEFAULT_GROUP: Readonly<Record<SportCategory, string>> = {
  run: 'run.bold',
  walk: 'walk.bold',
  ride: 'ride.bold',
  swim: 'swim.bold',
  gym: 'gym.bold',
  cardio: 'cardio.bold',
  flow: 'flow.minimal',
  court: 'court.bold',
  other: 'run.bold',
};
