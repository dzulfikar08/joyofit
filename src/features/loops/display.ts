/** The numbers of the planner as text, in the app language. Pure apart from the translation and number formats. */
import { fmtDecimal, fmtDuration, fmtInt, t } from '@/i18n';
import { formatRouteDistance } from '@/features/routes/routeModel';

import { figuresFor, TARGET_MODES, type LoopBody, type TargetMode } from './targets';

/** The big number of a target and the small unit beside it: `10.000` `langkah`, `7,25` `km`. */
export function bigNumber(mode: TargetMode, value: number): { number: string; unit: string } {
  const number = mode === 'distance' ? fmtDecimal(value / 1000, value % 1000 === 0 ? 0 : value % 500 === 0 ? 1 : 2) : fmtInt(Math.round(value));
  return { number, unit: t(`loops:unit.${mode}`) };
}

/** `10.000 langkah`, for a screen reader and for sentences. */
export function targetText(mode: TargetMode, value: number): string {
  const { number, unit } = bigNumber(mode, value);
  return `${number} ${unit}`;
}

/** One figure of a loop in `mode`, rounded the way it is shown: steps to 10, minutes and kcal to whole numbers. */
function figureText(mode: TargetMode, figure: number): string {
  switch (mode) {
    case 'steps':
      return t('common:units.steps', { value: fmtInt(Math.round(figure / 10) * 10) });
    case 'distance':
      return formatRouteDistance(figure);
    case 'time':
      return fmtDuration(Math.round(figure) * 60);
    case 'kcal':
      return t('common:units.kcal', { value: fmtInt(Math.round(figure)) });
  }
}

/** `≈ 7,0 km · 1 j 31 mnt · 407 kcal`: the other three figures of the loop the target stands for. */
export function secondaryLine(mode: TargetMode, meters: number, body: LoopBody): string {
  const figures = figuresFor(meters, body);
  const parts = TARGET_MODES.filter((m) => m !== mode).map((m) => figureText(m, figures[m]));
  return t('loops:approx', { parts: parts.join(' · ') });
}

/** `11:40` for 700 seconds per km. */
export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
