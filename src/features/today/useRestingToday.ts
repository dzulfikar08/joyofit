import Storage from 'expo-sqlite/kv-store';
import { useMemo } from 'react';

import { readCachedBmr } from '@/features/ai/data/personData';
import { bmrPerDay, restingSoFar, type RestingSource } from '@/features/today/restingEnergy';
import { HuaweiWear } from '@/wear';

/**
 * The resting energy burned so far today for the Today calories tile; null when there is no BMR (no cached JoyoRogo value and
 * no usable height, weight and birth year in Settings > Body profile). The BMR is read again once a minute, so a profile edited
 * in Settings shows on Today without a sync; `nowSec` moves the elapsed fraction.
 */
export function useRestingToday(dayStart: number | null, nowSec: number): { kcal: number; source: RestingSource } | null {
  const minute = Math.floor(nowSec / 60);
  const bmr = useMemo(
    () =>
      bmrPerDay({
        rogoBmr: readCachedBmr({ getItem: (k) => Storage.getItemSync(k), setItem: () => {}, removeItem: () => {} }, nowSec),
        profile: HuaweiWear.getUserProfile(),
        nowYear: new Date(nowSec * 1000).getFullYear(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minute],
  );
  if (!bmr || dayStart === null) return null;
  return { kcal: restingSoFar(bmr.kcal, dayStart, nowSec), source: bmr.source };
}
