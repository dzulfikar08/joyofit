import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { BleSensors } from '@/ble';
import { NotSignedInError } from '@/cloud/api';
import { RogoError, rogo } from '@/cloud/rogo';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { captureFinal, confirmPending, type CaptureContext, type LastSaved, type PendingWeighIn } from '@/features/scale/capture';
import type { Reference } from '@/features/scale/guard';
import { scaleHub } from '@/features/scale/instance';
import { profileWeightKg, scaleUserFrom } from '@/features/scale/profile';
import { protocolById } from '@/features/scale/registry';
import {
  deleteWeighIn,
  latestWeighIn,
  listScales,
  listWeighIns,
  pendingWeighIns,
  removeScale,
  renameScale,
  saveScale,
  touchScale,
  type SavedScale,
  type WeighIn,
} from '@/features/scale/store';
import { getAutoCapture, getGuardPercent, getPushToRogo, setAutoCapture, setGuardPercent, setPushToRogo } from '@/features/scale/settings';
import { pushPendingWeighIns } from '@/features/scale/sync';
import type { ScaleReading } from '@/features/scale/types';
import { WeighSession, type WeighStatus } from '@/features/scale/weigh';
import { pushLog } from '@/state/logStore';
import { ensureSensorPermissions, type Granted } from '@/features/sensors/permissions';
import { HuaweiWear } from '@/wear';

export interface ScaleSettings {
  autoCapture: boolean;
  guardPercent: number;
  pushToRogo: boolean;
}

export type ScaleProblem = 'permission' | 'off' | 'unavailable';

export interface ScaleLive {
  /** `off`: nothing is listening for the scale (no scale picked, auto-capture off and no test running, app in the background). */
  status: WeighStatus | 'off';
  /** The latest frame that is still settling, or the settled reading right after a weigh-in; null before the person stepped on. */
  reading: ScaleReading | null;
  /** The reading above is the settled one. */
  settled: boolean;
}

export interface ScaleContextValue {
  scale: SavedScale | null;
  loaded: boolean;
  weighIns: WeighIn[];
  /** Weigh-ins JoyoRogo does not have yet. */
  rogoWaiting: number;
  settings: ScaleSettings;
  updateSettings: (patch: Partial<ScaleSettings>) => void;
  live: ScaleLive;
  problem: ScaleProblem | null;
  /** The last weigh-in that was saved, so the screen can say so. */
  lastSaved: LastSaved | null;
  /** Starts listening with the fast radio and shows what the scale sends; asks for the Bluetooth permission first. */
  startTest: () => Promise<Granted>;
  stopTest: () => void;
  testing: boolean;
  /** Makes this scale the one JoyoFit listens to (replacing any earlier one). */
  pick: (found: { id: string; name: string; protocolId: string }) => Promise<void>;
  rename: (alias: string) => Promise<void>;
  forget: () => Promise<void>;
  remove: (id: number) => Promise<void>;
  retryPush: () => Promise<void>;
}

const ScaleContext = createContext<ScaleContextValue | null>(null);

export function useScale(): ScaleContextValue {
  const value = useContext(ScaleContext);
  if (!value) throw new Error('useScale must be used inside <ScaleProvider>');
  return value;
}

const OFF: ScaleLive = { status: 'off', reading: null, settled: false };

const traceDirection = { tx: 'tx', rx: 'rx', info: 'info', error: 'error' } as const;

/** Offline, signed out, a timeout: quiet, the weigh-in stays pending. A server answer (RogoError) is a real error and is kept on the row. */
const isUnavailable = (error: unknown): boolean => error instanceof NotSignedInError || !(error instanceof RogoError);

function problemOf(code: string | null): ScaleProblem {
  if (code === 'ERR_BLUETOOTH_PERMISSION') return 'permission';
  if (code === 'ERR_BLUETOOTH_OFF') return 'off';
  return 'unavailable';
}

/**
 * The scale the person picked, its weigh-ins, and the one session that listens for it. While the app is open and "Tangkap otomatis" is
 * on (or a test weigh-in is running) a `WeighSession` waits for the scale; every settled weigh-in goes through the multi-user question,
 * is saved locally, and is pushed to JoyoRogo's weight log. The radio is only used with a scale picked, so nothing here touches
 * Bluetooth (and on iOS never raises its prompt) until the person picked one.
 */
export function ScaleProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { t } = useTranslation('scale');
  const [scale, setScale] = useState<SavedScale | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [weighIns, setWeighIns] = useState<WeighIn[]>([]);
  const [rogoWaiting, setRogoWaiting] = useState(0);
  const [settings, setSettings] = useState<ScaleSettings>(() => ({
    autoCapture: getAutoCapture(),
    guardPercent: getGuardPercent(),
    pushToRogo: getPushToRogo(),
  }));
  const [live, setLive] = useState<ScaleLive>(OFF);
  const [problem, setProblem] = useState<ScaleProblem | null>(null);
  const [lastSaved, setLastSaved] = useState<LastSaved | null>(null);
  const [testing, setTesting] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [pending, setPending] = useState<PendingWeighIn | null>(null);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const lastSavedRef = useRef<LastSaved | null>(null);
  const alive = useRef(true);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const reload = useCallback(async () => {
    const [scales, rows, waiting] = await Promise.all([listScales(db), listWeighIns(db, 40), pendingWeighIns(db)]);
    if (!alive.current) return;
    setScale(scales[0] ?? null);
    setWeighIns(rows);
    setRogoWaiting(waiting.length);
    setLoaded(true);
  }, [db]);

  const pushNow = useCallback(async () => {
    if (!settingsRef.current.pushToRogo) return;
    try {
      await pushPendingWeighIns(db, rogo.checkInWeight, isUnavailable);
    } finally {
      await reload();
    }
  }, [db, reload]);

  useEffect(() => {
    alive.current = true;
    void reload().then(pushNow);
    const sub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state === 'active') void pushNow();
    });
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, [reload, pushNow]);

  const reference = useCallback(async (): Promise<Reference | null> => {
    const local = await latestWeighIn(db);
    if (local) return { weightKg: local.weightKg, at: local.takenAt };
    if (settingsRef.current.pushToRogo) {
      try {
        const remote = await rogo.latestWeighIn();
        if (remote) return { weightKg: remote.weightKg, at: Date.parse(remote.createdAt) || null };
      } catch {
        // Offline or signed out: the profile weight is the next yardstick.
      }
    }
    const weight = profileWeightKg(HuaweiWear.getUserProfile());
    return weight === null ? null : { weightKg: weight, at: null };
  }, [db]);

  const contextFor = useCallback(
    (found: SavedScale): CaptureContext => ({
      db,
      scaleId: found.id,
      protocolId: found.protocolId,
      user: scaleUserFrom(HuaweiWear.getUserProfile(), new Date().getFullYear()),
      guardPercent: settingsRef.current.guardPercent,
      pushToRogo: settingsRef.current.pushToRogo,
      now: Date.now(),
      reference,
    }),
    [db, reference],
  );

  const handleFinal = useCallback(
    (found: SavedScale, reading: ScaleReading, upgrade: boolean) => {
      chain.current = chain.current
        .then(async () => {
          const result = await captureFinal(contextFor(found), reading, upgrade, lastSavedRef.current);
          if (result.kind === 'confirm') {
            if (alive.current) setPending(result.pending);
            return;
          }
          if (result.kind === 'saved') {
            lastSavedRef.current = { id: result.weighIn.id, weightKg: result.weighIn.weightKg };
            if (alive.current) setLastSaved(lastSavedRef.current);
          }
          await touchScale(db, found.id, Date.now());
          await reload();
          await pushNow();
        })
        .catch((e: unknown) => {
          pushLog({ ts: Date.now(), direction: 'error', serviceId: null, commandId: null, hex: null, message: `scale: saving a weigh-in failed: ${String(e)}` });
        });
    },
    [contextFor, db, pushNow, reload],
  );

  // The one session that listens for the scale. It restarts only when the scale, the mode or the app state changes, never because a saved
  // weigh-in reloaded the list: a restart would forget which weigh-in was just saved and could save the same one twice.
  const scaleId = scale?.id ?? null;
  const protocolId = scale?.protocolId ?? null;
  const protocol = protocolId === null ? null : protocolById(protocolId);
  const scaleRef = useRef(scale);
  const finalRef = useRef(handleFinal);
  useEffect(() => {
    scaleRef.current = scale;
    finalRef.current = handleFinal;
  }, [scale, handleFinal]);

  const listening = protocol !== null && (settings.autoCapture || testing) && appActive;
  useEffect(() => {
    if (!listening || scaleId === null || protocol === null) return;
    let cancelled = false;
    const session = new WeighSession(
      scaleHub,
      { id: scaleId, protocol },
      { lowLatency: testing, user: () => scaleUserFrom(HuaweiWear.getUserProfile(), new Date().getFullYear()) },
      {
        onStatus: (status) => setLive((l) => ({ ...l, status })),
        onLive: (reading) => setLive((l) => ({ ...l, reading, settled: false })),
        onFinal: (reading, upgrade) => {
          setLive((l) => ({ ...l, reading, settled: true }));
          const current = scaleRef.current;
          if (current) finalRef.current(current, reading, upgrade);
        },
        onTrace: (line) =>
          pushLog({ ts: Date.now(), direction: traceDirection[line.direction], serviceId: null, commandId: null, hex: line.hex ?? null, message: `scale: ${line.message}` }),
        onProblem: (code) => {
          if (!cancelled) setProblem(problemOf(code));
        },
      },
    );
    void (async () => {
      // Never raises a prompt here: the person granted it when picking the scale; without it the screen says so.
      const radio = await BleSensors.bluetoothState().catch(() => 'unknown' as const);
      if (cancelled) return;
      if (radio !== 'on') {
        setProblem(radio === 'off' ? 'off' : radio === 'unauthorized' ? 'permission' : 'unavailable');
        return;
      }
      setProblem(null);
      try {
        await session.start();
      } catch (e) {
        if (!cancelled) setProblem(problemOf((e as { code?: string } | null)?.code ?? null));
      }
    })();
    return () => {
      cancelled = true;
      session.stop();
      setLive(OFF);
    };
  }, [listening, scaleId, protocol, testing]);

  const answerConfirm = useCallback(
    (mine: boolean) => {
      const held = pending;
      setPending(null);
      if (!held || !mine || !scale) return;
      chain.current = chain.current
        .then(async () => {
          const result = await confirmPending(contextFor(scale), held);
          if (result.kind === 'saved') {
            lastSavedRef.current = { id: result.weighIn.id, weightKg: result.weighIn.weightKg };
            if (alive.current) setLastSaved(lastSavedRef.current);
          }
          await reload();
          await pushNow();
        })
        .catch(() => {});
    },
    [contextFor, pending, pushNow, reload, scale],
  );

  const value = useMemo<ScaleContextValue>(
    () => ({
      scale,
      loaded,
      weighIns,
      rogoWaiting,
      settings,
      updateSettings: (patch) => {
        if (patch.autoCapture !== undefined) setAutoCapture(patch.autoCapture);
        if (patch.guardPercent !== undefined) setGuardPercent(patch.guardPercent);
        if (patch.pushToRogo !== undefined) setPushToRogo(patch.pushToRogo);
        settingsRef.current = { ...settingsRef.current, ...patch };
        setSettings((s) => ({ ...s, ...patch }));
        if (patch.pushToRogo) void pushNow();
      },
      live: listening ? live : OFF,
      problem: scale !== null && protocol === null ? 'unavailable' : problem,
      lastSaved,
      testing,
      startTest: async () => {
        const permission = await ensureSensorPermissions();
        if (permission === 'granted') setTesting(true);
        return permission;
      },
      stopTest: () => setTesting(false),
      pick: async (found) => {
        for (const old of await listScales(db)) if (old.id !== found.id) await removeScale(db, old.id);
        await saveScale(db, found, Date.now());
        await reload();
      },
      rename: async (alias) => {
        if (scale) await renameScale(db, scale.id, alias);
        await reload();
      },
      forget: async () => {
        setTesting(false);
        if (scale) await removeScale(db, scale.id);
        await reload();
      },
      remove: async (id) => {
        await deleteWeighIn(db, id);
        await reload();
      },
      retryPush: pushNow,
    }),
    [db, listening, live, lastSaved, loaded, problem, protocol, pushNow, reload, rogoWaiting, scale, settings, testing, weighIns],
  );

  return (
    <ScaleContext.Provider value={value}>
      {children}
      <ConfirmDialog
        visible={pending !== null}
        title={t('confirm.title')}
        message={t('confirm.message', {
          weight: pending ? pending.reading.weightKg.toFixed(1) : '',
          last: pending ? pending.referenceKg.toFixed(1) : '',
        })}
        confirmLabel={t('confirm.mine')}
        cancelLabel={t('confirm.notMine')}
        onConfirm={() => answerConfirm(true)}
        onCancel={() => answerConfirm(false)}
      />
    </ScaleContext.Provider>
  );
}
