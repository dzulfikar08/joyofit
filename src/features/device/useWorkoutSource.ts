import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { getWorkoutDevice, sourceName } from '@/features/device/watches';
import { shownName } from '@/features/device/shownName';
import { t } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';

/**
 * The watch a stored workout was recorded by, for the workout screen. Null with one watch (there is nothing to tell apart), for an
 * imported workout and for one stored before the app recorded the watch.
 */
export function useWorkoutSource(workoutId: number): string | null {
  const db = useSQLiteContext();
  const { watches } = useWatch();
  const [device, setDevice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getWorkoutDevice(db, workoutId).then(
      (found) => {
        if (live) setDevice(found);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [db, workoutId]);

  if (watches.length < 2) return null;
  return shownName(sourceName(watches, device, t('workouts:detail.more.removedWatch')));
}
