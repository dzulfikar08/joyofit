import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import type { WorkoutRow } from '@/db/queries';
import type { RideAnalysis } from '@/features/cycling/types';
import { gearShareLine } from '@/features/gear/format';
import { allGearTotals, gearOfWorkout } from '@/features/gear/store';
import { buildRunSubject } from '@/features/stickers/data/run';
import { StickerSheet } from '@/features/stickers/ui/StickerSheet';
import { ThreadsSheet } from '@/features/stickers/ui/ThreadsSheet';
import { useThreadsRunSubject } from '@/features/stickers/ui/useThreadsSubject';
import type { StrengthWorkout } from '@/features/strength/types';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import type { RoutePoint, WorkoutSummary } from '@/features/workouts/summary';
import { useLocale } from '@/i18n';

interface Props {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  route: readonly RoutePoint[];
  analysis: WorkoutAnalysis | null;
  /** The cycling metrics when the workout is a ride (`useRideData`); they feed the power, climbs and splits slides of Threads. */
  ride?: RideAnalysis | null;
  /** The strength log merged with this watch workout: its sets, reps and volume go on the gym cards. */
  strength?: StrengthWorkout | null;
  /** The look of the button; the host lays it out (a primary button that fills an action row, say). */
  variant?: ComponentProps<typeof Button>['variant'];
  style?: ComponentProps<typeof Button>['style'];
}

/** The "Share" button of a workout, the sticker sheet it opens and, from there, the Threads carousel sheet. */
export function ShareRunButton({ workout, summary, route, analysis, ride = null, strength = null, variant, style }: Props) {
  const { t } = useTranslation('common');
  const locale = useLocale();
  const db = useSQLiteContext();
  const [open, setOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [gearLine, setGearLine] = useState<string | null>(null);

  // The gear the workout was done with, and its lifetime distance, as "Sepatu: Nike Pegasus 41 · 312 km".
  useEffect(() => {
    if (!open && !threadsOpen) return;
    let live = true;
    (async () => {
      const gear = await gearOfWorkout(db, workout.start);
      const distance = gear ? (await allGearTotals(db)).get(gear.id)?.distanceM : undefined;
      if (live) setGearLine(gear && distance !== undefined ? gearShareLine(gear, distance) : null);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [db, open, threadsOpen, workout.start, locale]);

  const subject = useMemo(
    () => buildRunSubject({ workout, summary, analysis, route, gearLine, strength }, locale),
    [workout, summary, analysis, route, gearLine, strength, locale],
  );
  const threadsSubject = useThreadsRunSubject({ workout, summary, route, analysis, ride, gearLine }, threadsOpen);

  return (
    <>
      <Button label={t('actions.share')} icon="share-outline" variant={variant} style={style} onPress={() => setOpen(true)} />
      <StickerSheet subject={subject} visible={open} onClose={() => setOpen(false)} onThreads={() => setThreadsOpen(true)} />
      {threadsSubject ? <ThreadsSheet subject={threadsSubject} visible={threadsOpen} onClose={() => setThreadsOpen(false)} /> : null}
    </>
  );
}
