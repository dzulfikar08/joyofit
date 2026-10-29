import * as Linking from 'expo-linking';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { appleSignInAvailable, deleteJoyoRogoAccount, signInWithApple } from '@/cloud/account';
import { CloudLockedError, NotSignedInError } from '@/cloud/api';
import { authClient } from '@/cloud/auth';
import { APP_BUILD } from '@/cloud/build';
import { CLOUD_CONFIGURED } from '@/cloud/config';
import { signInWithNativeGoogle } from '@/cloud/googleNative';
import { nativeGoogleAvailable, requestGoogleIdToken } from '@/cloud/googleNativeDevice';
import { loadOverview, type CloudOverview } from '@/cloud/overview';
import { forgetRecordSync, syncRecords } from '@/cloud/recordSync';
import { restoreHealthWindow } from '@/cloud/healthSync';
import { rogoCall } from '@/cloud/rogo';
import { isSyncPaused, pauseSync, resumeSync } from '@/cloud/syncGate';
import { onUnmeteredNetwork, readSyncSettings, writeAutoSync, writeWifiOnly, type SyncSettings } from '@/cloud/syncSettings';
import { syncStrength } from '@/cloud/strengthSync';
import { runUpload } from '@/cloud/uploader';
import { pushWatchKcal } from '@/cloud/watchKcal';
import { flushWorkoutDeletes } from '@/features/workouts/deleteWorkout';
import {
  bindAccount,
  fetchCloudWorkoutStatus,
  pullWorkouts,
  pushWorkouts,
  wipeCloudData,
  type CloudWorkoutStatus,
  type UploadProgress,
} from '@/cloud/workoutSync';
import { releaseFamilyDevice } from '@/features/family/device';
import { cloudLog } from '@/cloud/log';
import { syncGear } from '@/features/gear/sync';
import { syncCoach } from '@/features/coach/sync';
import { adoptAccount, forgetCloudWorkouts, getCloudValue, resetCloudCursors, setCloudState } from '@/db/cloud';
import { accountSwitchOf, deleteAllLocalData, keepApart } from '@/db/localData';
import { errorMessage } from '@/format';
import { t } from '@/i18n';
import { AccountSwitchDialog, type SwitchChoice } from '@/features/settings/AccountSwitchDialog';
import { useWatch } from '@/state/WatchProvider';

/** Wait this long after a local sync (or app start) so bursts of events become one upload. */
const UPLOAD_DEBOUNCE_MS = 2_000;

/** How long the cloud Worker may keep answering "not Pro" for an account (`ACCESS_LOCKED_CACHE_TTL_MS` in server/src/limits.ts, plus a margin). */
const LOCKED_ANSWER_CACHE_MS = 11_000;

/** `cloud_state` key prefix of "this account's history was restored onto this phone"; one per account id. */
const RESTORE_DONE_PREFIX = 'restore_done:';
/** How far back the first sync of an account restores steps and sleep. */
const RESTORE_DAYS = 90;

export interface CloudContextValue {
  /** The cloud server URL is set in this build. */
  configured: boolean;
  signedIn: boolean;
  /** The session is still being read from secure storage. */
  sessionPending: boolean;
  /** JoyoRogo account email, from the session or the last upload. */
  email: string | null;
  /** A sync (pull, upload) is running. */
  uploading: boolean;
  /** Workouts uploaded so far in the running sync, out of the ones it started with; null between syncs. */
  progress: UploadProgress | null;
  /**
   * The server refused uploads because the account is not JoyoRogo Pro. Nothing is wrong: automatic uploads stop,
   * and coming back to the app or "Sync now" asks again, so a fresh purchase is picked up.
   */
  locked: boolean;
  /**
   * The account is JoyoRogo Pro (the cloud accepts uploads); false for a free account, null while that is not known yet
   * (not signed in, or neither a sync nor the cloud status has answered).
   */
  pro: boolean | null;
  /** History of the account is being restored onto this phone (first sync only); `total` is null until known. Null otherwise. */
  restoring: { done: number; total: number | null } | null;
  /** Last sign-in or sync failure. */
  error: string | null;
  /** Unix seconds of the last finished sync. */
  lastSyncAt: number | null;
  /** Step and sleep rows stored on the phone that the cloud does not have yet. */
  pendingRows: number | null;
  /** Workouts that the cloud does not have yet (or has with older numbers), and the size they will take. */
  pendingWorkouts: number | null;
  pendingBytes: number | null;
  /** Workouts the cloud refused as a document, and the last reason; retried after an app update. */
  refusedWorkouts: number;
  refusedError: string | null;
  /** The account's workouts in JoyoRogo; null until known (offline, or not asked yet). */
  cloudWorkouts: Pick<CloudWorkoutStatus, 'unlocked' | 'count' | 'bytes' | 'quotaBytes'> | null;
  /** Automatic runs wait for Wi-Fi or Ethernet. */
  wifiOnly: boolean;
  setWifiOnly: (value: boolean) => void;
  /** Runs start on their own after a local sync and when the app comes back. */
  autoSync: boolean;
  setAutoSync: (value: boolean) => void;
  /** "Delete cloud data" is running. */
  wiping: boolean;
  /**
   * Deletes the account's workouts, steps and sleep from the cloud, keeps this phone's data and the account, and turns
   * automatic sync off. Resolves false when it failed (`error` says why).
   */
  wipeCloud: () => Promise<boolean>;
  /** Sign in with Apple can run on this phone (iOS only). */
  appleAvailable: boolean;
  /** Sign in with Google. */
  signIn: () => Promise<void>;
  signInApple: () => Promise<void>;
  /** The JoyoRogo account is being deleted. */
  deleting: boolean;
  /**
   * Deletes the shared JoyoRogo account and its cloud data, then signs out here. Resolves false when nothing was
   * deleted (the Apple sheet was closed, or it failed: `error` says why).
   */
  deleteAccount: () => Promise<boolean>;
  /**
   * Signs out and keeps everything on this phone, unless `deleteLocalData`: then the session is closed first and
   * `deleteAllLocalData` runs after (`useAccountDialogs` only asks for it after the person chose it). A failed sign-out deletes nothing.
   */
  signOut: (options?: { deleteLocalData?: boolean }) => Promise<void>;
  /** Runs a sync now, whatever the Wi-Fi only setting says (the caller has asked the person). */
  syncNow: () => Promise<void>;
  /**
   * Pro may have just changed (a purchase or restore was credited): clears the lock, syncs and re-reads the account's Pro state so
   * gated screens open without a restart. When the cloud Worker still answers "locked" from its short cache, asks once more after it.
   */
  refreshPro: () => Promise<void>;
}

const CloudContext = createContext<CloudContextValue | null>(null);

export function useCloud(): CloudContextValue {
  const value = useContext(CloudContext);
  if (!value) throw new Error('useCloud must be used inside <CloudProvider>');
  return value;
}

/**
 * JoyoRogo sign-in plus the sync of the local database with the cloud. A sync pulls the workouts this phone does not have
 * from JoyoRogo, uploads the phone's workouts (one document each, JoyoRogo Pro) and sends steps and sleep to the JoyoFit
 * cloud Worker. It runs after every local sync the app sees (`dataVersion`), when the app comes to the foreground, and
 * on "Sync now"; automatic runs honour the "Automatic sync" and "Wi-Fi only" settings. Rows the background service
 * stored while the app was closed go up on the next of those. Syncs never overlap: a request made during one is served by
 * one more run right after it. Uploads are a Pro benefit: once the server says the account is not Pro, local syncs
 * stop triggering runs (no retry loop); only returning to the foreground and "Sync now" check again.
 */
export function CloudProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { dataVersion, dataChanged } = useWatch();
  const session = authClient.useSession();
  const signedIn = session.data?.user != null;
  const user = session.data?.user;
  const userRef = useRef(user);
  // After commit, so render stays pure; every effect and handler that reads it runs later.
  useLayoutEffect(() => {
    userRef.current = user;
  }, [user]);

  const [overview, setOverview] = useState<CloudOverview | null>(null);
  const [cloudWorkouts, setCloudWorkouts] = useState<CloudWorkoutStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [settings, setSettings] = useState<SyncSettings>(readSyncSettings);
  const settingsRef = useRef(settings);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const restoreRun = useRef<Promise<void> | null>(null);
  const [restoring, setRestoring] = useState<{ done: number; total: number | null } | null>(null);
  // A different account signed in on a phone that holds the previous account's data: sync stays paused until the person answers.
  const [accountSwitch, setAccountSwitch] = useState<{ previousEmail: string | null } | null>(null);
  const [switchChoice, setSwitchChoice] = useState<SwitchChoice | null>(null);
  // Deleting local data or settling an account switch is under way: nothing may resume sync meanwhile.
  const holdingSync = useRef(false);

  const refresh = useCallback(async () => {
    setOverview(await loadOverview(db, APP_BUILD));
  }, [db]);

  const refreshStatus = useCallback(async () => {
    try {
      setCloudWorkouts(await fetchCloudWorkoutStatus());
    } catch {
      // offline or not signed in: the last known figures stay
    }
  }, []);

  // Re-read after every local sync: new rows may be waiting.
  useEffect(() => {
    let live = true;
    loadOverview(db, APP_BUILD).then(
      (value) => live && setOverview(value),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [db, dataVersion]);

  useEffect(() => {
    if (signedIn) fetchCloudWorkoutStatus().then(setCloudWorkouts, () => {}); // offline: the last known figures stay
  }, [signedIn]);
  // Signing out forgets the last account's figures.
  if (!signedIn && cloudWorkouts !== null) setCloudWorkouts(null);

  const markLocked = useCallback((value: boolean) => {
    lockedRef.current = value;
    setLocked(value);
  }, []);

  // Signing out clears the lock; the next account is asked afresh.
  useEffect(() => {
    if (!signedIn) lockedRef.current = false;
  }, [signedIn]);
  if (!signedIn && locked) setLocked(false);

  /** True (and the dialog shown, sync paused) when `accountId` is not the account this phone's data belongs to. */
  const reviewAccount = useCallback(
    async (accountId: string): Promise<boolean> => {
      const found = await accountSwitchOf(db, accountId);
      if (found) {
        pauseSync();
        setAccountSwitch({ previousEmail: found.previousEmail });
      }
      return found !== null;
    },
    [db],
  );

  // Ask as soon as an account is known, even when no sync would run (automatic sync off, no cloud URL): the choice must not wait for one.
  const accountId = user?.id;
  // A known account starts with a clean error; none known drops a pending account switch.
  const [seenAccountId, setSeenAccountId] = useState(accountId);
  if (seenAccountId !== accountId) {
    setSeenAccountId(accountId);
    if (accountId) setError(null);
  }
  if (!accountId && accountSwitch !== null) setAccountSwitch(null);
  useEffect(() => {
    if (!accountId) {
      if (!holdingSync.current) resumeSync();
      return;
    }
    let live = true;
    // A new session starts clean: an error stored before this sign-in (for instance "not signed in") says nothing about it.
    void setCloudState(db, { last_error: null })
      .then(() => refresh())
      .catch(() => {});
    accountSwitchOf(db, accountId).then(
      (found) => {
        if (found) {
          pauseSync();
          setAccountSwitch({ previousEmail: found.previousEmail });
        }
        if (live && !found && !holdingSync.current) resumeSync();
      },
      (e) => cloudLog(`account check failed: ${errorMessage(e)}`, 'error'),
    );
    return () => {
      live = false;
    };
  }, [accountId, db, refresh]);

  /**
   * The first sync of an account on this phone also restores its recent steps and sleep (`restoreHealthWindow`), in the
   * background: the sync of everything else does not wait for it. It waits for Wi-Fi when "Wi-Fi only" is on and is tried
   * again at the next sync; the account is flagged only once it finished.
   */
  const restoreIfFirst = useCallback(
    (id: string) => {
      if (restoreRun.current) return;
      const flag = `${RESTORE_DONE_PREFIX}${id}`;
      restoreRun.current = (async () => {
        try {
          if ((await getCloudValue(db, flag)) !== null) return;
          if (settingsRef.current.wifiOnly && !(await onUnmeteredNetwork())) return;
          setRestoring({ done: 0, total: null });
          const restored = await restoreHealthWindow(db, {
            days: RESTORE_DAYS,
            onProgress: (done, total) => setRestoring({ done, total }),
          });
          await setCloudState(db, { [flag]: String(Date.now()) });
          if (restored.steps + restored.sleep > 0) dataChanged();
        } catch (e) {
          cloudLog(`restore from the cloud failed: ${errorMessage(e)}`, 'error');
        } finally {
          setRestoring(null);
          restoreRun.current = null;
        }
      })();
    },
    [db, dataChanged],
  );

  const syncNow = useCallback((): Promise<void> => {
    if (!CLOUD_CONFIGURED) {
      setError(t('common:errors.cloudUrlMissing'));
      return Promise.resolve();
    }
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async () => {
      setUploading(true);
      setError(null);
      try {
        do {
          again.current = false;
          const account = userRef.current;
          if (!account || isSyncPaused()) return;
          // Before anything is bound or sent: another account's phone data is never adopted without asking.
          if (await reviewAccount(account.id)) return;
          await bindAccount(db, account.id, account.email);
          // Workouts deleted on this phone that the account has not heard about yet go first, so the pull below cannot restore them (never throws).
          await flushWorkoutDeletes(db);
          // A manual sync or one that follows an account choice: the watch workouts' energy for JoyoRogo's diary (idempotent, never throws).
          await pushWatchKcal(db, account.id);
          await pullWorkouts(db);
          // Gear is small and a free account only reads it; a failure here must not fail the workouts' sync.
          await syncGear(db).catch((e) => cloudLog(`gear sync failed: ${errorMessage(e)}`, 'error'));
          // The Coach plan: read by every signed-in account, written by Pro; same rule, same isolation.
          await syncCoach(db).catch((e) => cloudLog(`coach sync failed: ${errorMessage(e)}`, 'error'));
          // Strength history: read by every signed-in account, written by Pro; after the workouts pull so a logged workout finds its watch row.
          await syncStrength(db).catch((e) => cloudLog(`strength sync failed: ${errorMessage(e)}`, 'error'));
          // Preferences, templates, routes and health records; reading is open to every account, writing is Pro.
          const records = await syncRecords(db).catch((e) => {
            cloudLog(`record sync failed: ${errorMessage(e)}`, 'error');
            return 'local-only' as const;
          });
          if (records !== 'local-only' && (records.quota || records.full)) setError(t('settings:cloud.recordsFull'));
          restoreIfFirst(account.id);
          const pushed = await pushWorkouts(db, setProgress);
          await runUpload(db);
          if (pushed.quota) setError(pushed.quota);
        } while (again.current);
        markLocked(false);
      } catch (e) {
        if (e instanceof CloudLockedError) {
          markLocked(true);
          await setCloudState(db, { last_error: null }).catch(() => {});
        } else if (e instanceof NotSignedInError) {
          // The session is read from the hook and the cookie from storage; the sign-in state is shown by `signedIn`, never as an error.
          cloudLog('sync skipped: no session cookie yet', 'error');
        } else setError(errorMessage(e));
      } finally {
        setUploading(false);
        setProgress(null);
        running.current = null;
        await refresh().catch(() => {});
        void refreshStatus();
      }
    })();
    running.current = run;
    return run;
  }, [db, refresh, refreshStatus, markLocked, reviewAccount, restoreIfFirst]);

  const refreshPro = useCallback(async () => {
    markLocked(false);
    await syncNow();
    await refreshStatus();
    if (!lockedRef.current) return;
    const { promise: cacheExpired, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, LOCKED_ANSWER_CACHE_MS);
    await cacheExpired;
    markLocked(false);
    await syncNow();
  }, [markLocked, syncNow, refreshStatus]);

  /** A run nobody asked for: only when automatic sync is on, and on Wi-Fi or Ethernet when "Wi-Fi only" is. */
  const autoSyncNow = useCallback(async () => {
    const { autoSync, wifiOnly } = settingsRef.current;
    if (!autoSync || (wifiOnly && !(await onUnmeteredNetwork()))) return;
    await syncNow();
  }, [syncNow]);

  // Sync after each local sync, and once at start, as soon as there is a session.
  useEffect(() => {
    if (!signedIn || !CLOUD_CONFIGURED || lockedRef.current) return;
    const timer = setTimeout(() => void autoSyncNow(), UPLOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signedIn, dataVersion, autoSyncNow]);

  // Rows from the background service arrive while the app is closed; pick them up on return.
  useEffect(() => {
    if (!signedIn || !CLOUD_CONFIGURED) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void autoSyncNow();
    });
    return () => subscription.remove();
  }, [signedIn, autoSyncNow]);

  /**
   * The energy of the watch's workouts goes to JoyoRogo's diary on its own track, not only inside `syncNow`: that run is skipped
   * for an account without the Pro cloud (`locked`) and stops at the first failure of an earlier step, and neither may keep a
   * workout out of the diary. Same settings as the other automatic sync: off with "Automatic sync" off, and on mobile data with
   * "Wi-Fi only" on. Never throws; what it sent or failed to send is shown in Settings, Koneksi, JoyoRogo.
   */
  const pushDiary = useCallback(async () => {
    const { autoSync, wifiOnly } = settingsRef.current;
    const account = userRef.current;
    if (!account || !autoSync || (wifiOnly && !(await onUnmeteredNetwork()))) return;
    await flushWorkoutDeletes(db);
    await pushWatchKcal(db, account.id);
  }, [db]);

  useEffect(() => {
    if (!signedIn) return;
    const timer = setTimeout(() => void pushDiary(), UPLOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signedIn, dataVersion, pushDiary]);

  useEffect(() => {
    if (!signedIn) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pushDiary();
    });
    return () => subscription.remove();
  }, [signedIn, pushDiary]);

  const changeSettings = useCallback((next: SyncSettings) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const setWifiOnly = useCallback(
    (wifiOnly: boolean) => {
      writeWifiOnly(wifiOnly);
      changeSettings({ ...settingsRef.current, wifiOnly });
    },
    [changeSettings],
  );

  const setAutoSync = useCallback(
    (autoSync: boolean) => {
      writeAutoSync(autoSync);
      changeSettings({ ...settingsRef.current, autoSync });
      if (autoSync && signedIn) void autoSyncNow();
    },
    [changeSettings, signedIn, autoSyncNow],
  );

  const wipeCloud = useCallback(async () => {
    setError(null);
    setWiping(true);
    // Off first, so nothing is uploaded again while the cloud is being emptied; it goes back on only if the wipe fails.
    const before = settingsRef.current.autoSync;
    writeAutoSync(false);
    changeSettings({ ...settingsRef.current, autoSync: false });
    try {
      if (running.current) await running.current;
      await wipeCloudData(db);
      await rogoCall<unknown>('sync/wipe', { ns: 'fit' });
      await forgetRecordSync(db);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      writeAutoSync(before);
      changeSettings({ ...settingsRef.current, autoSync: before });
      return false;
    } finally {
      setWiping(false);
      await refresh().catch(() => {});
      void refreshStatus();
    }
  }, [db, changeSettings, refresh, refreshStatus]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      // Android: Google's account picker (Play services) and the ID token to better-auth; the browser flow only for
      // binaries without the native module and installs where native sign-in cannot work.
      const outcome = await signInWithNativeGoogle({
        available: nativeGoogleAvailable,
        requestIdToken: requestGoogleIdToken,
        exchange: (token) => authClient.signIn.social({ provider: 'google', idToken: { token } }),
        log: (message) => cloudLog(message, 'error'),
      });
      if (outcome.kind === 'cancelled') return;
      if (outcome.kind === 'failed') {
        setError(outcome.reason || t('common:errors.signInFailed'));
        return;
      }
      if (outcome.kind === 'fallback') {
        const result = await authClient.signIn.social({ provider: 'google', callbackURL: Linking.createURL('/') });
        if (result.error) setError(result.error.message ?? t('common:errors.signInFailed'));
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let live = true;
    void appleSignInAvailable().then((ok) => live && setAppleAvailable(ok));
    return () => {
      live = false;
    };
  }, []);

  const signInApple = useCallback(async () => {
    setError(null);
    try {
      await signInWithApple();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    setError(null);
    setDeleting(true);
    try {
      if (!(await deleteJoyoRogoAccount())) return false;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setDeleting(false);
    }
    // The server session is gone with the account; this only clears the cookies stored on the phone.
    try {
      await authClient.signOut();
    } catch {
      // the account is already gone on the server
    }
    // Forget the deleted account here too: its id, email and sync time, and what had been uploaded to it.
    try {
      await resetCloudCursors(db);
      await forgetCloudWorkouts(db);
      await forgetRecordSync(db);
      await setCloudState(db, { user_id: null, email: null, last_sync_at: null, last_error: null });
      await refresh();
    } catch {
      // bookkeeping only; the next sign-in resets it again
    }
    return true;
  }, [db, refresh]);

  const signOut = useCallback(
    async ({ deleteLocalData = false }: { deleteLocalData?: boolean } = {}) => {
      setError(null);
      if (deleteLocalData) {
        holdingSync.current = true;
        pauseSync();
      }
      try {
        if (deleteLocalData) {
          // Nothing may still be writing rows when they are deleted, or a sync still be sending them.
          again.current = false;
          await Promise.all([running.current, restoreRun.current]);
        }
        // Family monitoring needs the session to revoke this phone's tokens, so it goes first; it never blocks signing out.
        await releaseFamilyDevice().catch(() => {});
        await authClient.signOut();
        if (deleteLocalData) {
          await deleteAllLocalData(db);
          dataChanged();
          await refresh().catch(() => {});
        }
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        if (deleteLocalData) {
          holdingSync.current = false;
          resumeSync();
        }
      }
    },
    [db, dataChanged, refresh],
  );

  /** The answer to the account switch dialog. A failure leaves the dialog open (sync still paused) with the error shown in Settings. */
  const resolveSwitch = useCallback(
    async (choice: SwitchChoice) => {
      const account = userRef.current;
      if (!account) return;
      setError(null);
      setSwitchChoice(choice);
      holdingSync.current = true;
      try {
        again.current = false;
        await Promise.all([running.current, restoreRun.current]);
        if (choice === 'delete') {
          await deleteAllLocalData(db);
          await adoptAccount(db, account.id, account.email);
        } else {
          await keepApart(db, account.id, account.email);
        }
        setAccountSwitch(null);
        holdingSync.current = false;
        resumeSync();
        dataChanged();
        await refresh().catch(() => {});
        void syncNow();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        holdingSync.current = false;
        setSwitchChoice(null);
      }
    },
    [db, dataChanged, refresh, syncNow],
  );

  /** Backing out of the account switch dialog: the new account is signed out again, the old data stays on the phone. */
  const leaveSwitch = useCallback(async () => {
    setAccountSwitch(null);
    await signOut();
  }, [signOut]);

  // Pro is known once a sync or the cloud status has answered.
  const pro = !signedIn ? null : locked ? false : cloudWorkouts ? cloudWorkouts.unlocked : null;

  const value = useMemo<CloudContextValue>(
    () => ({
      configured: CLOUD_CONFIGURED,
      signedIn,
      sessionPending: session.isPending,
      email: session.data?.user.email ?? overview?.state.email ?? null,
      uploading,
      progress,
      locked,
      pro,
      restoring,
      // A stored error belongs to the last account that synced; it is not shown while nobody is signed in.
      error: error ?? (signedIn ? (overview?.state.lastError ?? null) : null),
      lastSyncAt: overview?.state.lastSyncAt ?? null,
      pendingRows: overview?.pendingRows ?? null,
      pendingWorkouts: overview?.pendingWorkouts ?? null,
      pendingBytes: overview?.pendingBytes ?? null,
      refusedWorkouts: overview?.refusedWorkouts ?? 0,
      refusedError: overview?.refusedError ?? null,
      cloudWorkouts,
      wifiOnly: settings.wifiOnly,
      setWifiOnly,
      autoSync: settings.autoSync,
      setAutoSync,
      wiping,
      wipeCloud,
      appleAvailable,
      signIn,
      signInApple,
      deleting,
      deleteAccount,
      signOut,
      syncNow,
      refreshPro,
    }),
    [
      signedIn,
      session.isPending,
      session.data,
      overview,
      uploading,
      progress,
      locked,
      pro,
      restoring,
      error,
      cloudWorkouts,
      settings,
      setWifiOnly,
      setAutoSync,
      wiping,
      wipeCloud,
      appleAvailable,
      signIn,
      signInApple,
      deleting,
      deleteAccount,
      signOut,
      syncNow,
      refreshPro,
    ],
  );

  return (
    <CloudContext.Provider value={value}>
      {children}
      <AccountSwitchDialog
        visible={signedIn && accountSwitch !== null}
        previousEmail={accountSwitch?.previousEmail ?? null}
        choice={switchChoice}
        onChoose={(choice) => void resolveSwitch(choice)}
        onSignOut={() => void leaveSwitch()}
      />
    </CloudContext.Provider>
  );
}
