import { getT, type Locale } from '@/i18n';
import { formatDuration, formatKm, formatNumber, formatPace } from '../core/format';
import type { JsonObject } from '../subject';

export interface MetricFormatResult {
  value: string;
  unit?: string;
  label: string;
}

type TranslateFn = (key: string) => string;

function tr(key: string, locale: Locale, t?: TranslateFn): string {
  if (t) return t(key);
  const cleanKey = key.startsWith('stickers:') ? key.slice('stickers:'.length) : key;
  return getT(locale, 'stickers')(cleanKey as never) as string;
}

const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function formatMetric(
  run: JsonObject,
  metricId: string,
  locale: Locale = 'id',
  t?: TranslateFn,
): MetricFormatResult | null {
  const isSwim = run.category === 'swim';

  switch (metricId) {
    case 'time': {
      const sec = pos(run.movingSec) ? run.movingSec : pos(run.elapsedSec) ? run.elapsedSec : null;
      if (sec === null) return null;
      return { value: formatDuration(sec), label: tr('label.time', locale, t) };
    }
    case 'distance': {
      if (!pos(run.distanceM)) return null;
      return isSwim
        ? { value: formatNumber(run.distanceM, locale, 0), unit: tr('unit.m', locale, t), label: tr('label.distance', locale, t) }
        : { value: formatKm(run.distanceM, locale, 2), unit: tr('unit.km', locale, t), label: tr('label.distance', locale, t) };
    }
    case 'pace': {
      const p = isSwim ? (pos(run.pace100Sec) ? run.pace100Sec : run.paceSecKm) : (pos(run.paceSecKm) ? run.paceSecKm : run.pace100Sec);
      if (!pos(p)) return null;
      return isSwim
        ? { value: formatPace(p), unit: tr('unit.per100m', locale, t), label: tr('label.pace', locale, t) }
        : { value: formatPace(p), unit: tr('unit.perKm', locale, t), label: tr('label.pace', locale, t) };
    }
    case 'fastPace':
      return pos(run.paceFastestSec) ? { value: formatPace(run.paceFastestSec), unit: tr('unit.perKm', locale, t), label: tr('label.bestPace', locale, t) } : null;
    case 'speed':
      return pos(run.speedKmh) ? { value: formatNumber(run.speedKmh, locale, 1), unit: tr('unit.kmh', locale, t), label: tr('label.speed', locale, t) } : null;
    case 'maxSpeed':
      return pos(run.maxSpeedKmh) ? { value: formatNumber(run.maxSpeedKmh, locale, 1), unit: tr('unit.kmh', locale, t), label: tr('label.maxSpeed', locale, t) } : null;
    case 'hr':
      // The card's short label, as the fixed cards print it: the picker chip says "average", the card has no room for it.
      return pos(run.hrAvg) ? { value: formatNumber(run.hrAvg, locale, 0), unit: tr('unit.bpm', locale, t), label: tr('label.hr', locale, t) } : null;
    case 'hrMax':
      return pos(run.hrMax) ? { value: formatNumber(run.hrMax, locale, 0), unit: tr('unit.bpm', locale, t), label: tr('label.maxHr', locale, t) } : null;
    case 'minHr':
      return pos(run.minHr) ? { value: formatNumber(run.minHr, locale, 0), unit: tr('unit.bpm', locale, t), label: tr('label.minHr', locale, t) } : null;
    case 'kcal':
      return pos(run.kcal) ? { value: formatNumber(run.kcal, locale, 0), unit: tr('unit.kcal', locale, t), label: tr('label.kcal', locale, t) } : null;
    case 'elevation':
      return num(run.elevGainM) ? { value: formatNumber(run.elevGainM, locale, 0), unit: tr('unit.m', locale, t), label: tr('label.elevation', locale, t) } : null;
    case 'elevLoss':
      return num(run.elevLossM) ? { value: formatNumber(run.elevLossM, locale, 0), unit: tr('unit.m', locale, t), label: tr('label.elevLoss', locale, t) } : null;
    case 'cadence':
      return pos(run.cadence) ? { value: formatNumber(run.cadence, locale, 0), unit: tr(run.category === 'ride' ? 'unit.rpm' : 'unit.spm', locale, t), label: tr('label.cadence', locale, t) } : null;
    case 'power':
      return pos(run.power) ? { value: formatNumber(run.power, locale, 0), unit: tr('unit.watt', locale, t), label: tr('label.power', locale, t) } : null;
    case 'maxPower':
      return pos(run.maxPower) ? { value: formatNumber(run.maxPower, locale, 0), unit: tr('unit.watt', locale, t), label: tr('label.maxPower', locale, t) } : null;
    case 'steps':
      return pos(run.steps) ? { value: formatNumber(run.steps, locale, 0), label: tr('label.steps', locale, t) } : null;
    case 'jumps':
      return pos(run.jumps) ? { value: formatNumber(run.jumps, locale, 0), label: tr('label.jumps', locale, t) } : null;
    case 'jumpRate':
      return pos(run.jumpRate) ? { value: formatNumber(run.jumpRate, locale, 0), unit: tr('unit.perMin', locale, t), label: tr('label.jumpRate', locale, t) } : null;
    case 'longestStreak':
      return pos(run.longestStreak) ? { value: formatNumber(run.longestStreak, locale, 0), label: tr('label.longestStreak', locale, t) } : null;
    case 'interruptions':
      return pos(run.interruptions) ? { value: formatNumber(run.interruptions, locale, 0), label: tr('label.interruptions', locale, t) } : null;
    case 'laps':
      return pos(run.laps) ? { value: formatNumber(run.laps, locale, 0), label: tr('label.laps', locale, t) } : null;
    case 'swolf':
      return pos(run.swolf) ? { value: formatNumber(run.swolf, locale, 0), label: tr('label.swolf', locale, t) } : null;
    case 'strokes':
      return pos(run.strokes) ? { value: formatNumber(run.strokes, locale, 0), label: tr('label.strokes', locale, t) } : null;
    case 'strokeRate':
      return pos(run.strokeRate) ? { value: formatNumber(run.strokeRate, locale, 0), unit: tr('unit.spm', locale, t), label: tr('label.strokeRate', locale, t) } : null;
    case 'pool':
      return pos(run.poolM) ? { value: formatNumber(run.poolM, locale, 0), unit: tr('unit.m', locale, t), label: tr('label.pool', locale, t) } : null;
    case 'swimStyle':
      return typeof run.swimStyle === 'string' && run.swimStyle.length > 0 ? { value: run.swimStyle, label: tr('label.swimStyle', locale, t) } : null;
    case 'volume':
      // `run.volume` is already in the person's weight unit (`run.unit`: kg or lb).
      return pos(run.volume) ? { value: formatNumber(run.volume, locale, 0), unit: typeof run.unit === 'string' ? run.unit : undefined, label: tr('label.volume', locale, t) } : null;
    case 'sets':
      return pos(run.sets) ? { value: formatNumber(run.sets, locale, 0), label: tr('label.sets', locale, t) } : null;
    case 'reps':
      return pos(run.reps) ? { value: formatNumber(run.reps, locale, 0), label: tr('label.reps', locale, t) } : null;
    case 'exercises':
      return pos(run.exercises) ? { value: formatNumber(run.exercises, locale, 0), label: tr('label.exercises', locale, t) } : null;
    case 'stepLength':
      return pos(run.stepLengthCm) ? { value: formatNumber(run.stepLengthCm, locale, 0), unit: tr('unit.cm', locale, t), label: tr('label.stepLength', locale, t) } : null;
    case 'aerobic':
      return pos(run.aerobicEffect) ? { value: formatNumber(run.aerobicEffect, locale, 1), label: tr('label.aerobicEffect', locale, t) } : null;
    case 'anaerobic':
      return pos(run.anaerobicEffect) ? { value: formatNumber(run.anaerobicEffect, locale, 1), label: tr('label.anaerobicEffect', locale, t) } : null;
    case 'vo2max':
      return pos(run.vo2max) ? { value: formatNumber(run.vo2max, locale, 0), unit: tr('unit.mlKgMin', locale, t), label: tr('label.vo2max', locale, t) } : null;
    case 'recovery':
      return pos(run.recoveryHours) ? { value: formatNumber(run.recoveryHours, locale, 0), unit: tr('unit.hours', locale, t), label: tr('label.recoveryHours', locale, t) } : null;
    case 'workoutLoad':
      return pos(run.workoutLoad) ? { value: formatNumber(run.workoutLoad, locale, 0), label: tr('label.trainingLoad', locale, t) } : null;
    default:
      return null;
  }
}
