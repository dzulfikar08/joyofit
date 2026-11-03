import type { Locale } from '@/i18n';
import type { SportCategory } from '@/features/workouts/sportCategory';
import type { Template } from '../core/schema';
import { TEMPLATES } from '../catalog';
import type { JsonObject } from '../subject';
import { formatMetric } from './metricFormatter';
import {
  METRIC_CATALOG,
  PRIORITY_BY_CATEGORY,
  type MetricDef,
  type MetricDefinition,
} from './metricCatalog';

export {
  METRIC_CATALOG,
  type MetricDef,
  type MetricDefinition,
};

export const MAX_CUSTOM_METRICS = 4;
export const MAX_SECONDARY_METRICS = 4;
export const MIN_CUSTOM_METRICS = 1;

export interface CustomMetricsConfig {
  heroId: string;
  secondaryIds: string[];
}

const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function getDefaultHeroId(run: JsonObject, category: SportCategory): string {
  switch (category) {
    case 'gym':
      return pos(run.volumeKg) || pos(run.volume) ? 'volume' : 'time';
    case 'cardio':
      return pos(run.jumps) ? 'jumps' : 'time';
    case 'walk':
      return pos(run.distanceM) ? 'distance' : pos(run.steps) ? 'steps' : 'time';
    case 'run':
    case 'ride':
    case 'swim':
    case 'other':
      return pos(run.distanceM) ? 'distance' : 'time';
    case 'flow':
    case 'court':
      return 'time';
    default:
      return pos(run.distanceM) ? 'distance' : 'time';
  }
}

export function getHeroField(run: JsonObject, category: SportCategory): string | null {
  const heroId = getDefaultHeroId(run, category);
  const def = METRIC_CATALOG.find((m) => m.id === heroId);
  return def?.fields[0] ?? null;
}

export function getAvailableHeroMetrics(run: JsonObject, _category?: SportCategory): MetricDef[] {
  return METRIC_CATALOG.filter((m) => m.isAvailable(run));
}

export function getAvailableSecondaryMetrics(run: JsonObject, _category: SportCategory, heroId: string): MetricDef[] {
  return METRIC_CATALOG.filter((m) => m.isAvailable(run) && m.id !== heroId);
}

export function getAvailableMetrics(run: JsonObject, category: SportCategory): MetricDef[] {
  const heroId = getDefaultHeroId(run, category);
  return getAvailableSecondaryMetrics(run, category, heroId);
}

export function getDefaultSecondaryMetrics(
  run: JsonObject,
  category: SportCategory,
  heroId: string,
  maxSlots = MAX_SECONDARY_METRICS,
): string[] {
  const available = new Set(getAvailableSecondaryMetrics(run, category, heroId).map((m) => m.id));
  const priority = Object.hasOwn(PRIORITY_BY_CATEGORY, category)
    ? PRIORITY_BY_CATEGORY[category]
    : PRIORITY_BY_CATEGORY.other;
  const chosen: string[] = [];
  for (const id of priority) {
    if (available.has(id)) {
      chosen.push(id);
      if (chosen.length >= maxSlots) break;
    }
  }
  return chosen;
}

export function getDefaultConfig(
  run: JsonObject,
  category: SportCategory,
  maxSlots = MAX_SECONDARY_METRICS,
): CustomMetricsConfig {
  const heroId = getDefaultHeroId(run, category);
  return {
    heroId,
    secondaryIds: getDefaultSecondaryMetrics(run, category, heroId, maxSlots),
  };
}

export function getDefaultMetrics(run: JsonObject, category: SportCategory): string[] {
  return getDefaultConfig(run, category).secondaryIds;
}

function isConfigObject(v: unknown): v is CustomMetricsConfig {
  return typeof v === 'object' && v !== null && 'heroId' in v && typeof (v as CustomMetricsConfig).heroId === 'string' && Array.isArray((v as CustomMetricsConfig).secondaryIds);
}

function resolveConfig(run: JsonObject, configOrIds: CustomMetricsConfig | readonly string[]): CustomMetricsConfig {
  if (isConfigObject(configOrIds)) {
    const heroId = configOrIds.heroId;
    return {
      heroId,
      secondaryIds: configOrIds.secondaryIds.filter((id) => id !== heroId).slice(0, MAX_CUSTOM_METRICS),
    };
  }
  const category = (typeof run.category === 'string' && Object.hasOwn(PRIORITY_BY_CATEGORY, run.category))
    ? (run.category as SportCategory)
    : 'other';
  const heroId = getDefaultHeroId(run, category);
  const ids = Array.isArray(configOrIds) ? configOrIds : [];
  return {
    heroId,
    secondaryIds: ids.filter((id) => id !== heroId).slice(0, MAX_CUSTOM_METRICS),
  };
}

export function applyCustomMetrics(
  data: JsonObject,
  configOrIds: CustomMetricsConfig | readonly string[],
  options: {
    locale?: Locale;
    t?: (key: string) => string;
    maxSlots?: number;
    template?: Template | string | null;
  } = {},
): JsonObject {
  const originalRun = data.run as JsonObject | undefined;
  if (!originalRun) return data;

  const config = resolveConfig(originalRun, configOrIds);
  const locale = options.locale ?? 'id';
  const t = options.t;
  const maxSlots = options.maxSlots ?? (options.template ? getTemplateSecondarySlotCount(options.template) : undefined);
  const activeSecondary = maxSlots !== undefined && maxSlots > 0
    ? config.secondaryIds.slice(0, maxSlots)
    : config.secondaryIds;

  const heroResult = formatMetric(originalRun, config.heroId, locale, t);
  const slotResults = activeSecondary.map((id) => formatMetric(originalRun, id, locale, t));

  const cleanedRun: JsonObject = { ...originalRun };
  delete cleanedRun.heroVal;
  delete cleanedRun.heroUnit;
  delete cleanedRun.heroLabel;
  delete cleanedRun.slot1Val;
  delete cleanedRun.slot1Unit;
  delete cleanedRun.slot1Label;
  delete cleanedRun.slot2Val;
  delete cleanedRun.slot2Unit;
  delete cleanedRun.slot2Label;
  delete cleanedRun.slot3Val;
  delete cleanedRun.slot3Unit;
  delete cleanedRun.slot3Label;
  delete cleanedRun.slot4Val;
  delete cleanedRun.slot4Unit;
  delete cleanedRun.slot4Label;

  const newRun: JsonObject = {
    ...cleanedRun,
    _custom: true,
    ...(heroResult?.value !== undefined ? {
      heroVal: heroResult.value,
      ...(heroResult.unit ? { heroUnit: heroResult.unit } : {}),
      heroLabel: heroResult.label,
    } : {}),
  };

  slotResults.forEach((res, i) => {
    if (res?.value !== undefined) {
      const idx = i + 1;
      newRun[`slot${idx}Val`] = res.value;
      if (res.unit) newRun[`slot${idx}Unit`] = res.unit;
      newRun[`slot${idx}Label`] = res.label;
    }
  });

  return { ...data, run: newRun };
}

const customMetricsSupportCache = new WeakMap<Template, boolean>();
const secondarySlotCountCache = new WeakMap<Template, number>();

/** Inspects whether the given template binds or branches on `run._custom`. */
export function templateSupportsCustomMetrics(templateOrId: Template | string | null | undefined): boolean {
  if (!templateOrId) return false;
  const template = typeof templateOrId === 'string'
    ? TEMPLATES.find((t) => t.id === templateOrId)
    : templateOrId;
  if (!template) return false;
  const cached = customMetricsSupportCache.get(template);
  if (cached !== undefined) return cached;
  const supported = JSON.stringify(template.layers).includes('run._custom');
  customMetricsSupportCache.set(template, supported);
  return supported;
}

/** Inspects the maximum secondary metric slot count (1..4) supported by the given template. Returns 0 if custom metrics are not supported. */
export function getTemplateSecondarySlotCount(templateOrId: Template | string | null | undefined): number {
  if (!templateOrId) return 0;
  const template = typeof templateOrId === 'string'
    ? TEMPLATES.find((t) => t.id === templateOrId)
    : templateOrId;
  if (!template) return 0;
  const cached = secondarySlotCountCache.get(template);
  if (cached !== undefined) return cached;
  const json = JSON.stringify(template.layers);
  if (!json.includes('run._custom')) {
    secondarySlotCountCache.set(template, 0);
    return 0;
  }
  let maxSlot = 0;
  for (let i = 1; i <= MAX_CUSTOM_METRICS; i++) {
    if (json.includes(`slot${i}Val`)) maxSlot = i;
  }
  secondarySlotCountCache.set(template, maxSlot);
  return maxSlot;
}
