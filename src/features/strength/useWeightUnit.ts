import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useSyncExternalStore } from 'react';

import { loadSettings } from './store';
import { getWeightUnit, isWeightUnit, setWeightUnit, subscribeWeightUnit, type WeightUnit } from './units';

/**
 * The weight unit as React state. The formatters read the module unit themselves; call this in a component that draws a weight (or
 * memoises text made from one) so it redraws when the unit changes in Settings.
 */
export function useWeightUnit(): WeightUnit {
  return useSyncExternalStore(subscribeWeightUnit, getWeightUnit, getWeightUnit);
}

/**
 * Loads the saved unit once the database is open (mounted once, at the root: lifts also show up on the Workouts tab and in a workout's
 * detail, not only under /strength). Until it answers every weight reads kg.
 */
export function useHydrateWeightUnit(): void {
  const db = useSQLiteContext();
  useEffect(() => {
    let live = true;
    loadSettings(db).then(
      (settings) => {
        if (live) setWeightUnit(isWeightUnit(settings.weightUnit) ? settings.weightUnit : 'kg');
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [db]);
}
