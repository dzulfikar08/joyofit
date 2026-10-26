import * as Linking from 'expo-linking';
import { useSQLiteContext } from 'expo-sqlite';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { authClient } from '@/cloud/auth';
import { CLOUD_CONFIGURED } from '@/cloud/config';
import {
  autoUploadNewWorkouts,
  disconnectStrava,
  fetchStravaAuthorizeUrl,
  StravaSlotsFullError,
  syncStravaStatus,
  type StravaSlotsReason,
  type StravaStatus,
} from '@/cloud/strava';
import { isIos } from '@/components/IosUnavailable';
import { getStravaSettings, setStravaAddLink, setStravaAddDevice, type StravaSettings } from '@/db/strava';
import { errorMessage } from '@/format';
import { t } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';

/** Same debounce as the cloud upload: a burst of sync events becomes one pass. */
const AUTO_UPLOAD_DEBOUNCE_MS = 3_000;
/** The deep link the Worker's callback redirects to (`server/src/strava.ts`). */
const RETURN_URL = 'joyofit://settings/strava';

export interface StravaContextValue {
  /** The cloud server URL is set in this build (the Worker owns the Strava connection). */
  configured: boolean;
  /** A JoyoRogo session exists; connecting Strava needs it, uploading does not need Pro. */
  signedIn: boolean;
  settings: StravaSettings;
  /** False when the Worker has no Strava client secret yet. Null until it has answered. */
  serverReady: boolean | null;
  busy: boolean;
  error: string | null;
  /** What the Worker last said about Strava capacity while not connected. */
  slots: StravaSlots;
  /** `gear` also asks for `profile:read_all` (a second consent) so the athlete's shoes and bikes can be linked to JoyoFit's gear. */
  connect: (options?: { gear?: boolean }) => Promise<void>;
  disconnect: () => Promise<void>;
  setAddLink: (on: boolean) => Promise<void>;
  setAddDevice: (on: boolean) => Promise<void>;
  /** Re-reads the connection from the Worker (after returning from Strava or the app coming to the foreground). */
  refresh: () => Promise<void>;
}

const EMPTY: StravaSettings = { connectedAt: null, athleteId: null, addLink: false, addDevice: true, gearScope: false };

/** Strava capacity for a user who is not connected (the shared Strava application has a fixed number of athletes). */
export interface StravaSlots {
  /** No slot is open to this user now: connecting is refused. */
  full: boolean;
  reason: StravaSlotsReason | null;
  /** Unix seconds when the last connection was released to make room for Pro users; null when it was not. */
  releasedAt: number | null;
}

const OPEN: StravaSlots = { full: false, reason: null, releasedAt: null };

const slotsOf = (status: StravaStatus): StravaSlots =>
  status.connected
    ? OPEN
    : { full: status.slotsFull === true, reason: status.slotsReason ?? null, releasedAt: status.released?.at ?? null };

const StravaContext = createContext<StravaContextValue | null>(null);

export function useStrava(): StravaContextValue {
  const value = useContext(StravaContext);
  if (!value) throw new Error('useStrava must be used inside StravaProvider');
  return value;
}

const FAILURES: Record<string, 'accessDenied' | 'scopeMissing' | 'invalidState'> = {
  access_denied: 'accessDenied',
  scope_missing: 'scopeMissing',
  invalid_state: 'invalidState',
};

/**
 * The Strava connection of this phone: connect and disconnect through the Worker, the "add link" choice, and the
 * automatic upload of workouts that finish after connecting. Strava sync is free while slots are spare, so unlike the
 * cloud backup it does not need JoyoRogo Pro; it needs the JoyoRogo sign-in the Worker identifies the user with, and
 * a free slot in the shared Strava application (JoyoRogo keeps some for Pro users).
 */
export function StravaProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { dataVersion } = useWatch();
  const session = authClient.useSession();
  const signedIn = session.data?.user != null;

  const [settings, setSettings] = useState<StravaSettings>(EMPTY);
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<StravaSlots>(OPEN);
  /** Counts returns to the foreground, so the upload pass runs again each time. */
  const [foreground, setForeground] = useState(0);

  const reload = useCallback(async () => setSettings(await getStravaSettings(db)), [db]);

  const refresh = useCallback(async () => {
    if (CLOUD_CONFIGURED && signedIn) {
      const status = await syncStravaStatus(db);
      if (status) {
        setServerReady(status.configured);
        setSlots(slotsOf(status));
      }
    }
    await reload();
  }, [db, signedIn, reload]);

  /** The Worker refused a connection for capacity: show the slots-full state even if the status has not caught up. */
  const refusedForSlots = useCallback(async () => {
    const status = await syncStravaStatus(db);
    await reload();
    setSlots((current) => ({ ...(status ? slotsOf(status) : current), full: true, reason: status?.slotsReason ?? current.reason ?? 'full' }));
  }, [db, reload]);

  // At start and when the session appears: read the connection (the effect itself sets nothing synchronously).
  useEffect(() => {
    let live = true;
    (async () => {
      const status = CLOUD_CONFIGURED && signedIn ? await syncStravaStatus(db) : null;
      const stored = await getStravaSettings(db);
      if (!live) return;
      if (status) {
        setServerReady(status.configured);
        setSlots(slotsOf(status));
      }
      setSettings(stored);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [db, signedIn]);

  // Come back to the foreground: Strava may have been connected in the browser, or revoked on strava.com.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setForeground((n) => n + 1);
      void refresh().catch(() => {});
    });
    return () => subscription.remove();
  }, [refresh]);

  // New workouts arrive with each sync; send the ones that finished after connecting. On iOS the pass only runs while
  // the app is in front: iOS suspends the app mid-upload and locks the keychain item that holds the JoyoRogo session
  // while the phone is locked, so a background pass would fail and use up the workout's automatic attempts. What a
  // background sync stored is sent when the app comes back (`foreground`).
  useEffect(() => {
    if (!signedIn || !CLOUD_CONFIGURED || settings.connectedAt === null) return;
    const timer = setTimeout(() => {
      if (isIos && AppState.currentState !== 'active') return;
      void autoUploadNewWorkouts(db)
        .then(() => reload())
        .catch(() => {});
    }, AUTO_UPLOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [db, signedIn, settings.connectedAt, dataVersion, foreground, reload]);

  const connect = useCallback(async ({ gear = false }: { gear?: boolean } = {}) => {
    setError(null);
    setBusy(true);
    try {
      const url = await fetchStravaAuthorizeUrl({ gear });
      const result = await WebBrowser.openAuthSessionAsync(url, RETURN_URL);
      if (result.type === 'success') {
        const { reason } = Linking.parse(result.url).queryParams ?? {};
        if (reason === 'slots_full') return await refusedForSlots();
        if (typeof reason === 'string') setError(t(`common:strava.${FAILURES[reason] ?? 'failed'}`));
      }
      await refresh();
    } catch (e) {
      if (e instanceof StravaSlotsFullError) await refusedForSlots().catch(() => {});
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [refresh, refusedForSlots]);

  const disconnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await disconnectStrava(db);
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [db, reload]);

  const setAddLink = useCallback(
    async (on: boolean) => {
      await setStravaAddLink(db, on);
      await reload();
    },
    [db, reload],
  );

  const setAddDevice = useCallback(
    async (on: boolean) => {
      await setStravaAddDevice(db, on);
      await reload();
    },
    [db, reload],
  );

  const value = useMemo<StravaContextValue>(
    () => ({ configured: CLOUD_CONFIGURED, signedIn, settings, serverReady, busy, error, slots, connect, disconnect, setAddLink, setAddDevice, refresh }),
    [signedIn, settings, serverReady, busy, error, slots, connect, disconnect, setAddLink, setAddDevice, refresh],
  );

  return <StravaContext.Provider value={value}>{children}</StravaContext.Provider>;
}
