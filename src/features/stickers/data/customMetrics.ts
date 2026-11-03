import type { Locale } from '@/i18n';
import type { SportCategory } from '@/features/workouts/sportCategory';
import type { Template } from '../core/schema';
import type { JsonObject } from '../subject';
import { formatMetric } from './metricFormatter';
import { METRIC_CATALOG, PRIORITY_BY_CATEGORY, type MetricDef } from './metricCatalog';

/** The most secondary numbers any layout draws (`run.slot1Val`..`run.slot4Val`). */
export const MAX_SECONDARY_METRICS = 4;

const slotCounts = new WeakMap<Template, number>();

/**
 * The secondary slots a template draws for picked metrics: each layout binds exactly as many `run.slot<N>Val` as it has room
 * for (see `slotIds` in `templates/blocks.ts`), so its layers are the count. 0: a fixed template, no customizer.
 */
export function customSlotCount(template: Template): number {
  const known = slotCounts.get(template);
  if (known !== undefined) return known;
  const json = JSON.stringify(template.layers);
  let count = 0;
  while (count < MAX_SECONDARY_METRICS && json.includes(`run.slot${count + 1}Val`)) count++;
  slotCounts.set(template, count);
  return count;
}

export interface CustomMetricsConfig {
  heroId: string;
  secondaryIds: string[];
}

const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function getDefaultHeroId(run: JsonObject, category: SportCategory): string {
  switch (category) {
    case 'gym':
      return pos(run.volume) ? 'volume' : 'time';
    case 'cardio':
      return pos(run.jumps) ? 'jumps' : 'time';
    case 'walk':
      return pos(run.distanceM) ? 'distance' : pos(run.steps) ? 'steps' : 'time';
    case 'flow':
    case 'court':
      return 'time';
    default:
      return pos(run.distanceM) ? 'distance' : 'time';
  }
}

/** Every number the workout recorded; a word (the swim style) is never the hero. */
export function getAvailableHeroMetrics(run: JsonObject): MetricDef[] {
  return METRIC_CATALOG.filter((m) => !m.text && m.isAvailable(run));
}

export function getAvailableSecondaryMetrics(run: JsonObject, heroId: string): MetricDef[] {
  return METRIC_CATALOG.filter((m) => m.id !== heroId && m.isAvailable(run));
}

/** The sport's hero and its first four recorded numbers by the sport's priority. */
export function getDefaultConfig(run: JsonObject, category: SportCategory): CustomMetricsConfig {
  const heroId = getDefaultHeroId(run, category);
  const available = new Set(getAvailableSecondaryMetrics(run, heroId).map((m) => m.id));
  const priority = Object.hasOwn(PRIORITY_BY_CATEGORY, category) ? PRIORITY_BY_CATEGORY[category] : PRIORITY_BY_CATEGORY.other;
  return { heroId, secondaryIds: priority.filter((id) => available.has(id)).slice(0, MAX_SECONDARY_METRICS) };
}

const SLOT_FIELDS = [1, 2, 3, 4].flatMap((i) => [`slot${i}Val`, `slot${i}Unit`, `slot${i}Label`]);

/**
 * `data` with the picked numbers written into `run.heroVal|Unit|Label` and `run.slot<N>Val|Unit|Label`, and `run._custom` set
 * so the templates draw those instead of their fixed cells. Numbers the workout lacks are skipped and the slots close up, so a
 * layout's slots are always its first filled ones.
 */
export function applyCustomMetrics(
  data: JsonObject,
  config: CustomMetricsConfig,
  options: { locale?: Locale; t?: (key: string) => string } = {},
): JsonObject {
  const original = data.run as JsonObject | undefined;
  if (!original) return data;
  const locale = options.locale ?? 'id';

  const run: JsonObject = { ...original, _custom: true };
  for (const field of ['heroVal', 'heroUnit', 'heroLabel', ...SLOT_FIELDS]) delete run[field];

  const hero = formatMetric(original, config.heroId, locale, options.t);
  if (hero) {
    run.heroVal = hero.value;
    if (hero.unit) run.heroUnit = hero.unit;
    run.heroLabel = hero.label;
  }

  const slots = config.secondaryIds
    .filter((id) => id !== config.heroId)
    .map((id) => formatMetric(original, id, locale, options.t))
    .filter((res) => res !== null)
    .slice(0, MAX_SECONDARY_METRICS);
  slots.forEach((res, i) => {
    run[`slot${i + 1}Val`] = res.value;
    if (res.unit) run[`slot${i + 1}Unit`] = res.unit;
    run[`slot${i + 1}Label`] = res.label;
  });

  return { ...data, run };
}
