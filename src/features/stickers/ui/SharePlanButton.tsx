import { useMemo } from 'react';

import { liveDone, type DoneEntry } from '@/features/coach/doc';
import { allSessions } from '@/features/coach/plans/generate';
import type { PlanProgress } from '@/features/coach/progress';
import { useLocale, useTranslation, type Locale } from '@/i18n';

import { buildPlanSubject, type PlanShareInput } from '../data/plan';
import { ShareEntryButton } from './ShareEntryButton';

/** Maps the coach's progress and completion marks onto what the sticker needs (see `PlanShareInput`). */
export function planShareInput(progress: PlanProgress, rawDone: Record<string, DoneEntry>, nowMs: number): PlanShareInput {
  const done = liveDone(rawDone);
  const counted = allSessions(progress.weeks).filter((s) => !s.beforeStart);
  const next = progress.upcoming[0];
  return {
    planId: progress.plan.id,
    goal: progress.plan.goal,
    week: progress.weekIndex + 1,
    weeks: progress.plan.weeks,
    phase: progress.weeks[progress.weekIndex]?.phase ?? 'build',
    done: counted.filter((s) => done[s.key] !== undefined && !done[s.key]!.skipped).length,
    total: counted.length,
    weekComplete: progress.plannedThisWeek > 0 && progress.doneThisWeek >= progress.plannedThisWeek,
    next: next ? { type: next.type, distanceM: next.run?.distanceM ?? null, focus: next.strength?.focus ?? null } : null,
    nowMs,
  };
}

/** Reads the clock outside render: the subject is built when its inputs change, not on every render. */
function planSubjectNow(progress: PlanProgress, done: Record<string, DoneEntry>, locale: Locale) {
  return progress.state === 'active' ? buildPlanSubject(planShareInput(progress, done, Date.now()), locale) : null;
}

/** Share the active plan's progress. Not drawn unless the plan is running. */
export function SharePlanButton({ progress, done }: { progress: PlanProgress; done: Record<string, DoneEntry> }) {
  const { t } = useTranslation('stickers');
  const locale = useLocale();
  const subject = useMemo(() => planSubjectNow(progress, done, locale), [progress, done, locale]);
  return subject ? <ShareEntryButton subject={subject} label={t('ui.entry.plan')} /> : null;
}
