import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { ANDROID_PACKAGE, openFirst } from '@/features/updates/forceUpdate';
import { storeTargets } from '@/features/updates/forceUpdatePolicy';
import { playUpdates } from '@/features/updates/play';
import { useUpdateGate } from '@/features/updates/UpdateGateProvider';
import { isDismissed, isPlayInstaller, parseTimestamp, shouldCheck } from '@/features/updates/updatePolicy';
import { OTA_ENABLED, restartOta, useOtaUpdate } from '@/features/updates/useOtaUpdate';

/** What the banner renders. */
export type UpdateBannerModel =
  | { kind: 'available'; failed: boolean }
  | { kind: 'downloading'; percent: number | null }
  | { kind: 'ready' }
  /** The server says a newer build than this one exists (gate `latestBuild`); "Update" opens the store. */
  | { kind: 'newer' };

type Phase =
  | { step: 'idle' }
  | { step: 'available'; failed: boolean }
  | { step: 'downloading'; percent: number | null }
  | { step: 'ready' };

const DISMISSED_KEY = 'joyofit_update_dismissed_at';
const NEWER_DISMISSED_KEY = 'joyofit_newer_dismissed_at';

/**
 * Drives the in-app update banner. A downloaded OTA update (see useOtaUpdate) shows "Restart to update" on
 * any install. Binary updates only exist for installs made by the Play Store (any track): iOS (TestFlight and
 * the App Store notify on their own) and sideloaded APKs (JoyoFit has no public APK and no self-updater) get
 * nothing there. Checks on cold start and when the app returns to the foreground, at most once per 6 hours.
 * "Later" hides the banner for 24 hours.
 */
export function useAppUpdate() {
  const [enabled, setEnabled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [readyHidden, setReadyHidden] = useState(false);
  const lastCheckedAt = useRef<number | null>(null);
  const dismissedAt = useRef<number | null>(null);
  const { phase: otaState, check: checkOta } = useOtaUpdate();
  const [otaHidden, setOtaHidden] = useState(false);
  const lastOtaCheckAt = useRef<number | null>(null);
  const otaBannerShown = otaState === 'ready' && !otaHidden;
  const { decision } = useUpdateGate();
  const [newerHidden, setNewerHidden] = useState(true);
  const newerWanted = decision.kind === 'banner';

  const remember = useCallback((now: number) => {
    dismissedAt.current = now;
    setHidden(true);
    void SecureStore.setItemAsync(DISMISSED_KEY, String(now)).catch(() => {});
  }, []);

  const check = useCallback(async () => {
    if (!playUpdates) return;
    lastCheckedAt.current = Date.now();
    try {
      const res = await playUpdates.check(playUpdates.installedVersionCode());
      // Evaluated here, not in render: the 24 h window is a clock read.
      setHidden(isDismissed(dismissedAt.current, Date.now()));
      setPhase((current) => {
        // Never knock a running download or a ready restart back to "available".
        if (current.step === 'downloading' || current.step === 'ready') return current;
        if (res.state === 'available') return { step: 'available', failed: false };
        // Accepted before the process restarted: either still downloading or done. Start at "ready";
        // a status event flips it to "downloading" if bytes are still coming in.
        if (res.state === 'pending') return { step: 'ready' };
        return { step: 'idle' };
      });
    } catch {
      // Play not reachable or an old Play Store: stay silent, the next check retries.
    }
  }, []);

  // Cold start: decide whether this install is a Play install, then check once.
  useEffect(() => {
    if (Platform.OS !== 'android' || !playUpdates) return;
    let live = true;
    void (async () => {
      const [installer, stored] = await Promise.all([
        playUpdates.installer(),
        SecureStore.getItemAsync(DISMISSED_KEY).catch(() => null),
      ]);
      if (!live || !isPlayInstaller(installer)) return;
      dismissedAt.current = parseTimestamp(stored);
      setEnabled(true);
      await check();
    })();
    return () => {
      live = false;
    };
  }, [check]);

  // Play status events (download progress, finished, declined, failed).
  useEffect(() => {
    if (!enabled || !playUpdates) return;
    return playUpdates.subscribe((event) => {
      if (event.type === 'downloading') {
        setPhase({ step: 'downloading', percent: event.percent });
      } else if (event.type === 'downloaded') {
        setReadyHidden(false);
        setPhase({ step: 'ready' });
      } else if (event.type === 'failed') {
        setPhase({ step: 'available', failed: true });
      } else {
        remember(Date.now());
        setPhase({ step: 'available', failed: false });
      }
    });
  }, [enabled, remember]);

  // Resume, throttled.
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && shouldCheck(lastCheckedAt.current, Date.now())) void check();
    });
    return () => sub.remove();
  }, [enabled, check]);

  // OTA resume re-check, throttled. The launch check is expo-updates' own (ON_LOAD).
  useEffect(() => {
    if (!OTA_ENABLED) return;
    // The launch check counts as the last one: start the throttle from the mount time.
    lastOtaCheckAt.current ??= Date.now();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !shouldCheck(lastOtaCheckAt.current, Date.now())) return;
      lastOtaCheckAt.current = Date.now();
      void checkOta();
    });
    return () => sub.remove();
  }, [checkOta]);

  // The server-side "newer build" banner: its own 24 h "Later", read once (hidden until the stored value is known).
  useEffect(() => {
    let live = true;
    void SecureStore.getItemAsync(NEWER_DISMISSED_KEY)
      .catch(() => null)
      .then((stored) => {
        if (!live) return;
        const at = parseTimestamp(stored);
        setNewerHidden(isDismissed(at, Date.now()));
      });
    return () => {
      live = false;
    };
  }, []);

  const playBannerShown = enabled && (phase.step === 'downloading' || (phase.step === 'ready' && !readyHidden) || (phase.step === 'available' && !hidden));
  const newerShown = newerWanted && !newerHidden && !otaBannerShown && !playBannerShown;

  const dismiss = useCallback(() => {
    if (otaBannerShown) setOtaHidden(true);
    else if (playBannerShown && phase.step === 'ready') setReadyHidden(true);
    else if (playBannerShown) remember(Date.now());
    else {
      const now = Date.now();
      setNewerHidden(true);
      void SecureStore.setItemAsync(NEWER_DISMISSED_KEY, String(now)).catch(() => {});
    }
  }, [otaBannerShown, playBannerShown, phase.step, remember]);

  const openStore = useCallback(() => {
    if (decision.kind !== 'banner') return;
    void openFirst(storeTargets(Platform.OS, decision.storeUrl, ANDROID_PACKAGE).primary);
  }, [decision]);

  const update = useCallback(async () => {
    if (!playUpdates) return;
    setPhase({ step: 'downloading', percent: null });
    try {
      await playUpdates.startFlexible();
    } catch {
      setPhase({ step: 'available', failed: true });
    }
  }, []);

  const restart = useCallback(() => {
    if (otaBannerShown) void restartOta();
    else playUpdates?.restart();
  }, [otaBannerShown]);

  let banner: UpdateBannerModel | null = null;
  if (otaBannerShown) {
    // A downloaded OTA update beats every other prompt: one tap and the fix is live.
    banner = { kind: 'ready' };
  } else if (enabled) {
    if (phase.step === 'downloading') banner = { kind: 'downloading', percent: phase.percent };
    else if (phase.step === 'ready') banner = readyHidden ? null : { kind: 'ready' };
    else if (phase.step === 'available' && !hidden) {
      banner = { kind: 'available', failed: phase.failed };
    }
  }

  if (banner === null && newerShown) banner = { kind: 'newer' };

  return { banner, update: banner?.kind === 'newer' ? openStore : update, restart, dismiss };
}
