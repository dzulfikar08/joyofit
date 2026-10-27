/**
 * The caption that goes with the carousel: a short structured summary of the workout, an optional question ("Ada saran ...?"),
 * and the optional `#JoyoFit` tag. Pure; the text is the person's to edit afterwards, so nothing here is final.
 *
 * Threads allows 500 characters of text per post (Meta, "Threads Posts"): when the summary is longer, the least important lines go
 * first (the carousel pointer, the four-week line, the device), never the headline or the question.
 */
import { formatDuration, formatPace } from '@/features/workouts/analysis/types';
import { fmtDecimal, fmtInt, fmtNumber, getT, type Locale } from '@/i18n';

import type { JsonObject, StickerSubject } from '../subject';

export const THREADS_TEXT_MAX = 500;
export const THREADS_HASHTAG = '#JoyoFit';

export type QuestionKey = 'runPace' | 'runPlan' | 'runHr' | 'ridePower' | 'rideSpeed' | 'ridePlan' | 'liftProgress' | 'liftPlan' | 'generalPlan';

/** The question templates that fit a subject, most useful first. */
export function questionsFor(subject: Pick<StickerSubject, 'data'>): QuestionKey[] {
  const strength = subject.data.strength as JsonObject | undefined;
  if (strength) return ['liftProgress', 'liftPlan', 'generalPlan'];
  const run = (subject.data.run ?? {}) as JsonObject;
  const th = (subject.data.th ?? {}) as JsonObject;
  if (run.kind === 'ride') {
    const power = th.power !== undefined;
    return power ? ['ridePower', 'rideSpeed', 'ridePlan'] : ['rideSpeed', 'ridePlan', 'generalPlan'];
  }
  const out: QuestionKey[] = [];
  if (typeof run.paceSecKm === 'number') out.push('runPace');
  out.push('runPlan');
  if (typeof run.hrAvg === 'number') out.push('runHr');
  return out;
}

export interface CaptionOptions {
  locale: Locale;
  /** The question to append, or null for none. */
  question: QuestionKey | null;
  /** Append `#JoyoFit`. */
  hashtag: boolean;
  /** How many images go with the caption ("Data lengkap ada di 6 gambar"); omitted or 0 leaves the pointer out. */
  slideCount?: number;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pos = (v: unknown): v is number => num(v) && v > 0;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function runLines(subject: Pick<StickerSubject, 'data'>, locale: Locale): { head: string; stats: string | null; context: string | null } {
  const t = getT(locale, 'stickers');
  const run = subject.data.run as JsonObject;
  const th = (subject.data.th ?? {}) as JsonObject;
  const lead: string[] = [];
  if (pos(run.distanceM)) lead.push(t('threads.caption.part.distance', { value: fmtDecimal(run.distanceM / 1000, 2, locale) }));
  if (pos(run.movingSec)) lead.push(formatDuration(run.movingSec));
  if (pos(run.paceSecKm)) lead.push(t('threads.caption.part.pace', { value: formatPace(run.paceSecKm) }));
  else if (pos(run.speedKmh)) lead.push(t('threads.caption.part.speed', { value: fmtDecimal(run.speedKmh, 1, locale) }));
  const sport = str(run.sport) ?? '';
  const head = [sport, lead.join(' \u00b7 ')].filter((x) => x !== '').join(' ');

  const parts: string[] = [];
  if (pos(run.hrAvg) && pos(run.hrMax)) parts.push(t('threads.caption.part.hr', { avg: fmtInt(run.hrAvg, locale), max: fmtInt(run.hrMax, locale) }));
  else if (pos(run.hrAvg)) parts.push(t('threads.caption.part.hrAvg', { avg: fmtInt(run.hrAvg, locale) }));
  if (pos(run.elevGainM)) parts.push(t('threads.caption.part.elev', { value: fmtInt(run.elevGainM, locale) }));
  if (pos(run.cadence)) parts.push(t('threads.caption.part.cadence', { value: fmtInt(run.cadence, locale) }));
  if (pos(run.power)) parts.push(t('threads.caption.part.power', { value: fmtInt(run.power, locale) }));
  if (pos(run.kcal)) parts.push(t('threads.caption.part.kcal', { value: fmtInt(run.kcal, locale) }));

  const ctx = th.ctx as JsonObject | undefined;
  let context: string | null = null;
  if (ctx && pos(ctx.distanceM) && pos(ctx.sessions)) {
    context = t('threads.caption.context.distance', { distance: fmtNumber(ctx.distanceM / 1000, 1, locale), count: ctx.sessions });
  } else if (ctx && pos(ctx.sessions)) {
    context = t('threads.caption.context.sessions', { count: ctx.sessions });
  }
  return { head, stats: parts.length > 0 ? parts.join(', ') : null, context };
}

function liftLines(subject: Pick<StickerSubject, 'data'>, locale: Locale): { head: string; stats: string | null; context: string | null } {
  const t = getT(locale, 'stickers');
  const s = subject.data.strength as JsonObject;
  const th = (subject.data.th ?? {}) as JsonObject;
  const lead: string[] = [];
  if (pos(s.volume)) lead.push(t('threads.caption.part.volume', { value: fmtInt(s.volume, locale), unit: str(s.unit) ?? 'kg' }));
  if (pos(s.sets)) lead.push(t('threads.caption.part.sets', { count: s.sets }));
  if (pos(s.reps)) lead.push(t('threads.caption.part.reps', { count: s.reps }));
  else if (pos(s.seconds)) lead.push(t('threads.caption.part.hold', { value: formatDuration(s.seconds) }));
  if (pos(s.durationSec)) lead.push(formatDuration(s.durationSec));
  const head = [str(s.name) ?? '', lead.join(' \u00b7 ')].filter((x) => x !== '').join(': ');

  const parts: string[] = [];
  if (pos(s.exercises)) parts.push(t('threads.caption.part.exercises', { count: s.exercises }));
  if (pos(s.prCount)) parts.push(t('threads.caption.part.prs', { count: s.prCount }));
  if (pos(s.avgRpe)) parts.push(t('threads.caption.part.rpe', { value: fmtNumber(s.avgRpe, 1, locale) }));
  if (pos(s.kcal)) parts.push(t('threads.caption.part.kcal', { value: fmtInt(s.kcal, locale) }));

  const ctx = th.ctx as JsonObject | undefined;
  const context = ctx && pos(ctx.volume) && pos(ctx.sessions) ? t('threads.caption.context.volume', { volume: fmtInt(ctx.volume, locale), unit: str(ctx.unit) ?? 'kg', count: ctx.sessions }) : null;
  return { head, stats: parts.length > 0 ? parts.join(', ') : null, context };
}

/** The caption text for the workout in `subject`. Never longer than `THREADS_TEXT_MAX`. */
export function buildCaption(subject: Pick<StickerSubject, 'data'>, opts: CaptionOptions): string {
  const t = getT(opts.locale, 'stickers');
  const th = (subject.data.th ?? {}) as JsonObject;
  const lines = subject.data.strength ? liftLines(subject, opts.locale) : runLines(subject, opts.locale);
  const device = str(th.device);

  // Ordered by how much a reader needs it: dropped from the end when the 500 characters run out.
  const optional: (string | null)[] = [
    lines.stats,
    device ? t('threads.caption.device', { device }) : null,
    lines.context,
    opts.slideCount && opts.slideCount > 1 ? t('threads.caption.swipe', { count: opts.slideCount }) : null,
  ];
  const tail = [opts.question ? t(`threads.caption.question.${opts.question}`) : null, opts.hashtag ? THREADS_HASHTAG : null].filter((x): x is string => x !== null);

  const assemble = (kept: (string | null)[]): string => [lines.head, ...kept.filter((x): x is string => x !== null), ...tail].filter((x) => x !== '').join('\n');
  const kept = [...optional];
  while (assemble(kept).length > THREADS_TEXT_MAX) {
    const last = kept.map((x, i) => (x === null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
    if (last < 0) break;
    kept[last] = null;
  }
  const text = assemble(kept);
  return text.length > THREADS_TEXT_MAX ? `${text.slice(0, THREADS_TEXT_MAX - 3).trimEnd()}...` : text;
}
