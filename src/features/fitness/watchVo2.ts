import Storage from 'expo-sqlite/kv-store';

import type { Vo2Status } from '@/features/fitness/vo2max';

/**
 * The watch's latest VO2max, kept so the heart-rate energy equation (`keytelKcalPerMin`) can use it synchronously when a recording
 * starts. Written whenever the Today screen works out VO2max (`vo2maxStatus`): the watch's own value is kept, and anything else
 * (JoyoFit's resting-HR estimate, or no value) clears it, so a reading older than `vo2maxStatus`'s window stops counting. Local only.
 */
const KEY = 'joyofit.fitness.watchVo2';

export function rememberWatchVo2(status: Vo2Status | null): void {
  const value = status?.source === 'watch' ? String(Math.round(status.value * 10) / 10) : null;
  if (Storage.getItemSync(KEY) === value) return;
  if (value === null) Storage.removeItemSync(KEY);
  else Storage.setItemSync(KEY, value);
}

/** The watch's VO2max (ml/kg/min), or null when the watch has not measured one recently. */
export function watchVo2(): number | null {
  const raw = Storage.getItemSync(KEY);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : null;
}
