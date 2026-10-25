/**
 * The app's band link for the Run recorder: the one `BandLink` (`bandLinkCore.ts`) wired to the native module, the person's setting, and
 * the hook the screens read. See `docs/live-run.md`.
 */
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { cloudLog as log } from '@/cloud/log';
import { hasNative, HuaweiWear } from '@/wear';

import { BandLink, type BandLinkNative, type BandLinkPhase, type BandLinkSnapshot } from './bandLinkCore';

export type { BandLinkPhase, BandLinkSnapshot } from './bandLinkCore';

const ENABLED_KEY = 'joyofit.record.bandStart';
const settingListeners = new Set<() => void>();

/** The setting "start the band with the run": on unless the person turned it off. */
export function getBandStartEnabled(): boolean {
  return Storage.getItemSync(ENABLED_KEY) !== '0';
}

export function setBandStartEnabled(enabled: boolean): void {
  Storage.setItemSync(ENABLED_KEY, enabled ? '1' : '0');
  for (const l of settingListeners) l();
}

const subscribeSetting = (listener: () => void) => {
  settingListeners.add(listener);
  return () => {
    settingListeners.delete(listener);
  };
};

export function useBandStartEnabled(): boolean {
  return useSyncExternalStore(subscribeSetting, getBandStartEnabled);
}

/** A watch exists in this person's life (the link is on one now, or one was remembered): a phone with none never hears about a band. */
export function hasWatch(): boolean {
  try {
    return (HuaweiWear.getDevice()?.address ?? HuaweiWear.getBackgroundStatus().address ?? null) !== null;
  } catch {
    return false;
  }
}

/**
 * The band's realtime heart rate while a recording runs: held as a workout holds it where the binary can (it then also runs with the app in
 * the background), else asked like Today asks (it stops when the app leaves the foreground).
 */
function startBandHeartRate(listener: (bpm: number, ts: number) => void): () => void {
  try {
    const subscription = HuaweiWear.addListener('onHeartRate', (event) => listener(event.bpm, event.ts));
    const held = hasNative('setWorkoutHeartRate');
    if (held) HuaweiWear.setWorkoutHeartRate(true);
    else void HuaweiWear.setLiveHeartRate(true).catch((e: unknown) => log(`record: band heart rate not started: ${String(e)}`));
    return () => {
      subscription.remove();
      try {
        if (held) HuaweiWear.setWorkoutHeartRate(false);
        else void HuaweiWear.setLiveHeartRate(false).catch(() => undefined);
      } catch {
        // The link is gone; nothing to switch off.
      }
    };
  } catch (e) {
    log(`record: band heart rate not started: ${String(e)}`);
    return () => undefined;
  }
}

/** The band of the recording in progress. It outlives the recording screen, like the recording itself. */
export const bandLink = new BandLink({
  native: () => (hasNative('getWatchWorkout') && hasNative('startWatchWorkout') ? (HuaweiWear as BandLinkNative) : null),
  enabled: () => getBandStartEnabled() && hasWatch(),
  heartRate: startBandHeartRate,
  log: (message) => log(`record: band ${message}`),
});

export function useBandLink(): BandLinkSnapshot {
  return useSyncExternalStore(bandLink.subscribe, bandLink.getSnapshot);
}

/** The `workouts` namespace key of the one line a phase has for the recording screen; null for `off`. */
export function bandLinkLine(phase: BandLinkPhase): `record.bandLink.${Exclude<BandLinkPhase, 'off'>}` | null {
  return phase === 'off' ? null : `record.bandLink.${phase}`;
}
