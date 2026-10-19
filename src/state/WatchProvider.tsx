import { useEventListener } from 'expo';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { getLastSync } from '@/db/queries';
import { purgeDeletedWorkouts } from '@/features/workouts/purgeDeleted';
import { useWatchList, type WatchListActions } from '@/features/device/useWatchList';
import type { WatchRow } from '@/features/device/watches';
import { describeConnectFailure, errorCode } from '@/features/device/connectFailure';
import { outcomeOfFailure, type AutoOutcome } from '@/features/device/autoReconnect';
import { reportDatabaseError } from '@/db/recovery';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';
import { setDisconnectedByUser, useAutoReconnect, useAutoReconnectControl } from '@/state/useAutoReconnect';
import {
  HuaweiWear,
  type DeviceInfo,
  type FitnessTotals,
  type LinkState,
  type SyncSummary,
} from '@/wear';

export type WatchTotals = FitnessTotals & { at: number };

export interface WatchContextValue {
  linkState: LinkState;
  /** Last connection/sync failure; cleared when a new connect or sync starts. */
  error: string | null;
  /** Address of the watch being connected or connected; null when idle. */
  activeAddress: string | null;
  device: DeviceInfo | null;
  battery: number | null;
  /** `SyncSummary.to` of the last stored sync for the active watch, unix seconds. */
  lastSync: number | null;
  /** Totals reported by the watch in the most recent sync seen by this app session; `at` = `SyncSummary.to`. */
  totals: WatchTotals | null;
  /** Bumped after every stored sync so data screens re-query. */
  dataVersion: number;
  /** Call after rows were written outside a sync (a FIT import), so the data screens re-query. */
  dataChanged: () => void;
  connect: (address: string) => Promise<void>;
  /** Set when a connect stopped before a first bind; the watch the person has to agree to bind this phone to. */
  bindRequest: { address: string } | null;
  /** Agree to the bind and connect again. */
  confirmBind: () => Promise<void>;
  cancelBind: () => void;
  /** The watch of the last connect that could not reach it (busy elsewhere, out of reach); `connect` to it again is Retry. */
  retryAddress: string | null;
  /** The last connect reached the watch over Bluetooth but the watch never answered: the Watch tab shows the checklist and the report button. */
  silentWatch: boolean;
  disconnect: () => Promise<void>;
  forget: (address: string) => Promise<void>;
  /** Disconnects the watch in use, if any, and connects [address]: the one link moves to another watch. */
  switchTo: (address: string) => Promise<void>;
  /** Disconnects, forgets the watch's keys and takes it out of the list. Its stored data stays. */
  removeWatch: (address: string) => Promise<void>;
  /** Every watch this phone has used (the `device` table), primary first. */
  watches: WatchRow[];
  watchActions: WatchListActions;
  refreshBattery: () => Promise<void>;
  sync: () => Promise<void>;
  /** Pulls everything the watch still holds again; rows already stored are kept. */
  syncFullHistory: () => Promise<void>;
}

/** How long after a failed connect() a disconnect event's English error is still the same failure, not news. */
const CONNECT_EVENT_GRACE_MS = 1500;

const WatchContext = createContext<WatchContextValue | null>(null);

export function useWatch(): WatchContextValue {
  const value = useContext(WatchContext);
  if (!value) throw new Error('useWatch must be used inside <WatchProvider>');
  return value;
}

/**
 * Single owner of link state, device info and the native event subscriptions.
 * Mounted once at the root so every tab reads the same state.
 */
export function WatchProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [linkState, setLinkState] = useState<LinkState>(() => HuaweiWear.getState());
  const [error, setError] = useState<string | null>(null);
  const [bindRequest, setBindRequest] = useState<{ address: string } | null>(null);
  const [retryAddress, setRetryAddress] = useState<string | null>(null);
  const [silentWatch, setSilentWatch] = useState(false);
  // The background service may already own the link when the UI starts; read it synchronously.
  const [device, setDevice] = useState<DeviceInfo | null>(() => HuaweiWear.getDevice());
  const [activeAddress, setActiveAddress] = useState<string | null>(() =>
    HuaweiWear.getState() === 'disconnected'
      ? null
      : (HuaweiWear.getDevice()?.address ?? HuaweiWear.getBackgroundStatus().address),
  );
  const [battery, setBattery] = useState<number | null>(() => HuaweiWear.getDevice()?.batteryLevel ?? null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [totals, setTotals] = useState<WatchTotals | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const { watches, actions: watchActions } = useWatchList(db, `${dataVersion}:${device?.address ?? ''}`);
  const syncing = useRef(false);
  // A failed connect() reports its failure through the rejected promise (worded for the person); the state event the native side emits
  // for the same failure carries the English log line, which must not replace it.
  const connectInFlight = useRef(false);
  const connectFailedAt = useRef(0);
  // The automatic reconnect: a connect the person starts resets it.
  const autoReconnect = useAutoReconnectControl();

  /** Adopts a link that the background service connected while the UI was not watching. */
  const adoptNativeLink = useCallback(async () => {
    const info = HuaweiWear.getDevice();
    const address = info?.address ?? HuaweiWear.getBackgroundStatus().address;
    if (info) {
      setDevice(info);
      setBattery(info.batteryLevel);
    }
    setActiveAddress(address);
    if (address) setLastSync(await getLastSync(db, address));
  }, [db]);

  const applySummary = useCallback((summary: SyncSummary) => {
    setLastSync(summary.to);
    setTotals({ ...summary.totals, at: summary.to });
    setDataVersion((v) => v + 1);
  }, []);

  // Last stored sync of the remembered watch, so Today shows it before any connect.
  useEffect(() => {
    const address = HuaweiWear.getDevice()?.address ?? HuaweiWear.getBackgroundStatus().address;
    if (!address) return;
    let live = true;
    getLastSync(db, address).then(
      (last) => {
        if (live) setLastSync(last);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [db]);

  useEventListener(HuaweiWear, 'onStateChange', (event) => {
    setLinkState(event.state);
    if (event.state === 'connecting') setError(null);
    const connectOwnsError =
      event.state === 'disconnected' && (connectInFlight.current || Date.now() - connectFailedAt.current < CONNECT_EVENT_GRACE_MS);
    if (event.error && !connectOwnsError) setError(event.error);
    if (event.state === 'disconnected') {
      setActiveAddress(null);
      setDevice(null);
      setBattery(null);
      return;
    }
    if ((event.state === 'connected' || event.state === 'syncing') && !device) {
      void adoptNativeLink().catch((e) => setError(errorMessage(e)));
    }
    if (!activeAddress) setActiveAddress(HuaweiWear.getBackgroundStatus().address);
  });
  useEventListener(HuaweiWear, 'onBattery', (event) => setBattery(event.level));
  useEventListener(HuaweiWear, 'onLog', pushLog);
  useEventListener(HuaweiWear, 'onSyncComplete', applySummary);

  /**
   * One connect to [address]. `silent` is the automatic reconnect: it asks nothing and shows nothing (no error, no Retry, no first-bind
   * question; a watch that needs one stops it), so a watch that is off when the app opens is not an error the person has to read.
   */
  const connectTo = useCallback(
    async (address: string, silent: boolean): Promise<AutoOutcome> => {
      if (!silent) {
        autoReconnect.reset();
        void setDisconnectedByUser(false);
        setError(null);
        setRetryAddress(null);
        setSilentWatch(false);
        setBindRequest(null);
      }
      setActiveAddress(address);
      connectInFlight.current = true;
      try {
        const info = await HuaweiWear.connect(address);
        setDevice(info);
        setBattery(info.batteryLevel);
        setLastSync(await getLastSync(db, info.address));
        setRetryAddress(null);
        setSilentWatch(false);
        return 'connected';
      } catch (e) {
        connectFailedAt.current = Date.now();
        setActiveAddress(null);
        if (silent) return outcomeOfFailure(errorCode(e));
        // The error below is what the person reads next; an automatic retry behind it would replace it with another connecting state.
        autoReconnect.settle();
        const failure = describeConnectFailure(e);
        if (failure.kind === 'bind') {
          // Nothing changed on the watch. Binding replaces its current phone pairing, so the person decides first.
          setBindRequest({ address });
          return 'blocked';
        }
        setError(failure.message);
        if (failure.kind === 'unreachable' || failure.kind === 'silent' || failure.kind === 'unpaired') setRetryAddress(address);
        setSilentWatch(failure.kind === 'silent');
        return 'failed';
      } finally {
        connectInFlight.current = false;
      }
    },
    [db, autoReconnect],
  );

  const connect = useCallback(
    async (address: string) => {
      await connectTo(address, false);
    },
    [connectTo],
  );

  useAutoReconnect(autoReconnect, {
    linkState,
    isBusy: () => connectInFlight.current || bindRequest !== null || syncing.current,
    attempt: (address) => connectTo(address, true),
  });

  /** The person agreed to the bind: the next connect to this watch may start it. */
  const confirmBind = useCallback(async () => {
    if (!bindRequest) return;
    HuaweiWear.confirmBind(bindRequest.address);
    await connect(bindRequest.address);
  }, [bindRequest, connect]);

  const cancelBind = useCallback(() => setBindRequest(null), []);

  const disconnect = useCallback(async () => {
    // The person chose to let go: closing the app, or the link event that follows, must not take the watch back. Written before the
    // link closes, so the reconnect that closing wakes up already finds it.
    await setDisconnectedByUser(true);
    try {
      await HuaweiWear.disconnect();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const removeWatch = useCallback(
    async (address: string) => {
      try {
        if (activeAddress === address) await HuaweiWear.disconnect();
        await HuaweiWear.forgetDevice(address);
        await watchActions.removeRow(address);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [activeAddress, watchActions],
  );
  // Forgetting a pairing is removing the watch: a watch without keys is no use in the list.
  const forget = removeWatch;

  const switchTo = useCallback(
    async (address: string) => {
      if (linkState === 'syncing' || linkState === 'connecting' || linkState === 'authenticating' || linkState === 'initializing') return;
      if (linkState !== 'disconnected') {
        if (activeAddress === address) return;
        try {
          await HuaweiWear.disconnect();
        } catch (e) {
          setError(errorMessage(e));
          return;
        }
      }
      await connect(address);
    },
    [linkState, activeAddress, connect],
  );

  const refreshBattery = useCallback(async () => {
    try {
      setBattery(await HuaweiWear.refreshBattery());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const runSync = useCallback(
    async (pull: () => Promise<SyncSummary>) => {
      if (!device || syncing.current) return;
      syncing.current = true;
      setError(null);
      try {
        applySummary(await pull());
      } catch (e) {
        // The native writer (Kotlin, its own SQLite) can be the one that meets a damaged file; the repair starts for it too.
        reportDatabaseError(e);
        setError(errorMessage(e));
      } finally {
        syncing.current = false;
      }
    },
    [device, applySummary],
  );

  const dataChanged = useCallback(() => setDataVersion((v) => v + 1), []);

  // The watch's history brings back a workout the person deleted (it re-sends everything after the newest one it knows of): the copy
  // goes again after every sync, at start, and when the app returns from a background sync, before any screen or upload reads it.
  useEffect(() => {
    let live = true;
    void purgeDeletedWorkouts(db).then((purged) => {
      if (live && purged > 0) setDataVersion((v) => v + 1);
    });
    return () => {
      live = false;
    };
  }, [db, dataVersion]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void purgeDeletedWorkouts(db).then((purged) => purged > 0 && setDataVersion((v) => v + 1));
    });
    return () => subscription.remove();
  }, [db]);

  const sync = useCallback(() => runSync(() => HuaweiWear.syncActivity()), [runSync]);
  const syncFullHistory = useCallback(() => runSync(() => HuaweiWear.syncFullHistory()), [runSync]);

  const value = useMemo<WatchContextValue>(
    () => ({
      linkState,
      error,
      activeAddress,
      device,
      battery,
      lastSync,
      totals,
      dataVersion,
      dataChanged,
      connect,
      bindRequest,
      confirmBind,
      cancelBind,
      retryAddress,
      silentWatch,
      disconnect,
      forget,
      switchTo,
      removeWatch,
      watches,
      watchActions,
      refreshBattery,
      sync,
      syncFullHistory,
    }),
    [
      linkState,
      error,
      activeAddress,
      device,
      battery,
      lastSync,
      totals,
      dataVersion,
      dataChanged,
      connect,
      bindRequest,
      confirmBind,
      cancelBind,
      retryAddress,
      silentWatch,
      disconnect,
      forget,
      switchTo,
      removeWatch,
      watches,
      watchActions,
      refreshBattery,
      sync,
      syncFullHistory,
    ],
  );

  return <WatchContext.Provider value={value}>{children}</WatchContext.Provider>;
}
