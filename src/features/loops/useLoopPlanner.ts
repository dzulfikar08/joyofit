import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatRouteDate } from '@/features/routes/copy';
import { isAborted } from '@/features/routes/map/http';
import type { LatLon } from '@/features/routes/map/geometry';
import type { MapLibre } from '@/features/routes/map/maplibre';
import { routing } from '@/features/routes/map/services';
import { formatRouteDistance, type RoutePoint, type SavedRoute } from '@/features/routes/routeModel';
import { renameRoute, saveRoute } from '@/features/routes/routeStore';
import { useRoutePush, type RoutePush } from '@/features/routes/useRoutePush';
import { ensureLocation, locationGranted } from '@/features/sensors/permissions';
import { errorMessage } from '@/format';
import { t } from '@/i18n';

import { loadBody } from './bodyStore';
import { DEFAULT_COUNT, generateLoops, LoopError, type LoopCandidate, type LoopFailure } from './generate';
import { loadPaintedArea, type PaintedArea } from './paintedStore';
import { advance, currentLoop, poolKey, type Pool } from './pool';
import { currentPosition } from './position';
import type { LoopPrefs, StartFrom } from './prefs';
import { getHome, getPrefs, setHome, setPrefs } from './prefsStore';
import {
  convertTarget,
  loopLengthM,
  scaleFor,
  snapToScale,
  targetForLength,
  type BodySources,
  type LoopActivity,
  type LoopBody,
  type TargetMode,
} from './targets';

/** The target a new session starts with, in metres. */
const DEFAULT_LOOP_M = 5000;

export type LocationAnswer = 'unknown' | 'granted' | 'denied' | 'blocked';
export type FindStatus = 'idle' | 'finding' | 'error';

export interface LoopPlanner {
  prefs: LoopPrefs;
  /** Stride, pace and weight for the chosen activity; null while they load. */
  body: { body: LoopBody; sources: BodySources } | null;
  /** The target in the unit of `prefs.mode`; null while the body loads. */
  value: number | null;
  /** Loop length the target stands for, in metres. */
  targetM: number | null;
  home: LatLon | null;
  location: LocationAnswer;
  /** Reading the phone's position. */
  locating: boolean;
  /** The position was asked for and did not come. */
  locateFailed: boolean;
  start: LatLon | null;
  area: PaintedArea | null;
  status: FindStatus;
  /** Which loop of the batch is being tried, while `status` is `finding`. */
  progress: { index: number; count: number } | null;
  error: string | null;
  /** The loop on the map; null when there is none for the current target and start. */
  loop: LoopCandidate | null;
  /** Loops were made for another target or start than the ones now chosen. */
  stale: boolean;
  /** The saved copy of the loop on the map. */
  saved: SavedRoute | null;
  saving: boolean;
  saveError: string | null;
  push: RoutePush;
  setActivity: (activity: LoopActivity) => void;
  setMode: (mode: TargetMode) => void;
  setValue: (value: number) => void;
  setStartFrom: (from: StartFrom) => void;
  askLocation: () => Promise<void>;
  readLocation: () => Promise<void>;
  setHomePoint: (point: LatLon) => void;
  setHomeHere: () => Promise<boolean>;
  clearHome: () => void;
  find: () => void;
  save: () => Promise<SavedRoute | null>;
  sendToWatch: () => void;
}

const FAILURE_COPY: Record<LoopFailure, 'noRoad' | 'noLoop' | 'network'> = { no_road: 'noRoad', no_loop: 'noLoop', network: 'network' };

/** Everything the loop screen does besides drawing: the choices, the data they need, finding loops, saving and sending one. */
export function useLoopPlanner(maplibre: MapLibre): LoopPlanner {
  const db = useSQLiteContext();
  const [prefs, setPrefsState] = useState<LoopPrefs>(getPrefs);
  const [home, setHomeState] = useState<LatLon | null>(getHome);
  const [location, setLocation] = useState<LocationAnswer>('unknown');
  const [here, setHere] = useState<LatLon | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const [bodyInfo, setBodyInfo] = useState<{ body: LoopBody; sources: BodySources } | null>(null);
  const [value, setValueState] = useState<number | null>(prefs.value);
  const [areaOf, setAreaOf] = useState<{ lat: number; lon: number; area: PaintedArea } | null>(null);
  const [pool, setPool] = useState<Pool | null>(null);
  const [status, setStatus] = useState<FindStatus>('idle');
  const [progress, setProgress] = useState<{ index: number; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedById, setSavedById] = useState<Readonly<Record<string, SavedRoute>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const abort = useRef<AbortController | null>(null);
  /** Routed length over ring size, learned from the batches so far; the next batch starts from it. */
  const ratio = useRef<number | undefined>(undefined);
  /** The loop length at the moment the activity changed: the new activity keeps it, in its own unit. */
  const keepMeters = useRef<number | null>(null);
  const sendAfterSave = useRef(false);

  const start = prefs.startFrom === 'home' ? home : here;
  // The history read for another start is not this start's history.
  const area = areaOf && start && areaOf.lat === start.lat && areaOf.lon === start.lon ? areaOf.area : null;
  const targetM = bodyInfo && value !== null ? loopLengthM(prefs.mode, value, bodyInfo.body) : null;
  const key = start && targetM !== null ? poolKey(start, targetM, prefs.activity) : null;
  const loop = currentLoop(pool, key);
  const stale = pool !== null && key !== null && pool.key !== key;

  useEffect(() => {
    setPrefs({ ...prefs, value });
  }, [prefs, value]);

  useEffect(() => () => abort.current?.abort(), []);

  const readLocation = useCallback(async () => {
    setLocating(true);
    setLocateFailed(false);
    const position = await currentPosition(maplibre);
    setHere(position);
    setLocateFailed(position === null);
    setLocating(false);
  }, [maplibre]);

  // What the person already allowed is read without asking; with location allowed, "here" is read at once.
  useEffect(() => {
    let live = true;
    void locationGranted().then(
      (granted) => {
        if (!live) return;
        setLocation(granted ? 'granted' : 'unknown');
        if (granted && prefs.startFrom === 'here') void readLocation();
      },
      () => {},
    );
    return () => {
      live = false;
    };
    // Only at open: later changes go through `setStartFrom` and `askLocation`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    void loadBody(db, prefs.activity).then((loaded) => {
      if (!live) return;
      setBodyInfo(loaded);
      setValueState((current) => {
        if (keepMeters.current !== null) {
          const next = targetForLength(prefs.mode, keepMeters.current, loaded.body);
          keepMeters.current = null;
          return next;
        }
        if (current === null) return targetForLength(prefs.mode, DEFAULT_LOOP_M, loaded.body);
        return snapToScale(current, scaleFor(prefs.mode, loaded.body));
      });
    });
    return () => {
      live = false;
    };
    // The mode is read once the body arrives; a mode switch converts the value itself (`setMode`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, prefs.activity]);

  const startLat = start?.lat;
  const startLon = start?.lon;
  useEffect(() => {
    if (startLat === undefined || startLon === undefined) return;
    let live = true;
    void loadPaintedArea(db, { lat: startLat, lon: startLon }).then(
      (area) => {
        if (live) setAreaOf({ lat: startLat, lon: startLon, area });
      },
      () => {
        // A history that cannot be read means no novelty figure, not no loop.
        if (live) setAreaOf({ lat: startLat, lon: startLon, area: { index: null, lines: [], workouts: 0 } });
      },
    );
    return () => {
      live = false;
    };
  }, [db, startLat, startLon]);

  const update = useCallback((patch: Partial<LoopPrefs>) => {
    setPrefsState((current) => ({ ...current, ...patch }));
    setError(null);
  }, []);

  const setActivity = useCallback(
    (activity: LoopActivity) => {
      if (activity === prefs.activity) return;
      keepMeters.current = bodyInfo && value !== null ? loopLengthM(prefs.mode, value, bodyInfo.body) : null;
      update({ activity });
    },
    [prefs.activity, prefs.mode, bodyInfo, value, update],
  );

  const setMode = useCallback(
    (mode: TargetMode) => {
      if (mode === prefs.mode || !bodyInfo || value === null) return;
      setValueState(convertTarget(prefs.mode, value, mode, bodyInfo.body));
      update({ mode });
    },
    [prefs.mode, bodyInfo, value, update],
  );

  const setValue = useCallback((next: number) => {
    setValueState(next);
    setError(null);
  }, []);

  const setStartFrom = useCallback(
    (from: StartFrom) => {
      update({ startFrom: from });
      if (from === 'here' && location === 'granted' && here === null && !locating) void readLocation();
    },
    [update, location, here, locating, readLocation],
  );

  const askLocation = useCallback(async () => {
    const answer = await ensureLocation();
    setLocation(answer === 'granted' ? 'granted' : answer === 'blocked' ? 'blocked' : 'denied');
    if (answer === 'granted') await readLocation();
  }, [readLocation]);

  const setHomePoint = useCallback(
    (point: LatLon) => {
      setHome(point);
      setHomeState(point);
      update({ startFrom: 'home' });
    },
    [update],
  );

  const setHomeHere = useCallback(async () => {
    let granted = location === 'granted';
    if (!granted) {
      // The sheet explained why before this button; the system dialog opens from the tap.
      const answer = await ensureLocation();
      setLocation(answer === 'granted' ? 'granted' : answer === 'blocked' ? 'blocked' : 'denied');
      granted = answer === 'granted';
    }
    const position = granted ? await currentPosition(maplibre) : null;
    if (position === null) return false;
    setHomePoint(position);
    return true;
  }, [location, maplibre, setHomePoint]);

  const clearHome = useCallback(() => {
    setHome(null);
    setHomeState(null);
    if (prefs.startFrom === 'home') update({ startFrom: 'here' });
  }, [prefs.startFrom, update]);

  const find = useCallback(() => {
    if (!start || targetM === null || !area || !key) return;
    // "Another route" shows the next loop of the batch; a new batch is made only when they have all been shown.
    if (pool) {
      const next = advance(pool, key);
      if (next) {
        setPool(next);
        return;
      }
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setStatus('finding');
    setError(null);
    setProgress({ index: 1, count: DEFAULT_COUNT });
    generateLoops({
      start,
      targetM,
      painted: area.index,
      seed: Math.floor(Math.random() * 0x7fffffff),
      ratio: ratio.current,
      signal: controller.signal,
      router: (waypoints, signal) => routing.routeVia('foot', waypoints, signal),
      onProgress: (index, count) => setProgress({ index, count }),
    }).then(
      (result) => {
        ratio.current = result.ratio;
        setPool({ key, candidates: result.candidates, at: 0 });
        setStatus('idle');
        setProgress(null);
      },
      (e: unknown) => {
        if (isAborted(e) || controller.signal.aborted) return;
        setStatus('error');
        setProgress(null);
        setError(t(`loops:errors.${e instanceof LoopError ? FAILURE_COPY[e.kind] : 'network'}`));
      },
    );
  }, [start, targetM, area, key, pool]);

  const saved = loop ? (savedById[loop.id] ?? null) : null;
  const points = useMemo<RoutePoint[]>(() => (loop ? loop.line.map((p) => ({ lat: p.lat, lon: p.lon, alt: null })) : []), [loop]);
  const loopId = loop?.id;

  const remember = useCallback(
    (route: SavedRoute) => {
      if (loopId !== undefined) setSavedById((current) => ({ ...current, [loopId]: route }));
    },
    [loopId],
  );

  const save = useCallback(async (): Promise<SavedRoute | null> => {
    if (!loop || saved) return saved;
    setSaving(true);
    setSaveError(null);
    try {
      const name = t('loops:routeName', { distance: formatRouteDistance(loop.lengthM), date: formatRouteDate(Date.now()) });
      const route = await saveRoute({ name, source: 'drawn', points });
      remember(route);
      return route;
    } catch (e) {
      setSaveError(t('loops:errors.save', { message: errorMessage(e) }));
      return null;
    } finally {
      setSaving(false);
    }
  }, [loop, saved, points, remember]);

  const rename = useCallback(
    async (name: string) => {
      if (!saved) return null;
      const renamed = await renameRoute(saved.id, name);
      if (renamed) remember(renamed);
      return renamed;
    },
    [saved, remember],
  );

  const push = useRoutePush({ route: saved, points, rename, onSent: remember });
  const { send } = push;

  const sendToWatch = useCallback(() => {
    if (saved) {
      void send();
      return;
    }
    sendAfterSave.current = true;
    void save().then((route) => {
      if (route === null) sendAfterSave.current = false;
    });
  }, [saved, send, save]);

  // The loop was saved to be sent: `send` only sees the saved route after the next render.
  useEffect(() => {
    if (saved && sendAfterSave.current) {
      sendAfterSave.current = false;
      void send();
    }
  }, [saved, send]);

  return {
    prefs,
    body: bodyInfo,
    value,
    targetM,
    home,
    location,
    locating,
    locateFailed,
    start,
    area,
    status,
    progress,
    error,
    loop,
    stale,
    saved,
    saving,
    saveError,
    push,
    setActivity,
    setMode,
    setValue,
    setStartFrom,
    askLocation,
    readLocation,
    setHomePoint,
    setHomeHere,
    clearHome,
    find,
    save,
    sendToWatch,
  };
}
