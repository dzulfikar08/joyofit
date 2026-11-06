/**
 * Turn alerts during a workout the wearer starts on the watch with a route (the watch's own route navigation, drawn on its offline map).
 * The wearer arms one saved route on its page; when the watch reports an outdoor run, walk or ride (`LiveWorkout`), the turn-alert session
 * starts for that route and stops when the workout ends. The phone cannot start the watch's workout itself (the watch refuses `17/01` from
 * JoyoFit, protocol/README.md "Workout started from the phone"), so following the watch is the way in.
 */
import Storage from 'expo-sqlite/kv-store';

import { isActive } from '@/features/live/liveWorkout';
import { loadRoute } from '@/features/routes/routeStore';
import { pushLog } from '@/state/logStore';
import type { LiveWorkout } from '@/wear';

import { readWatchNavStatus, turnAlertSession, turnAlertsAvailable, watchNavSession } from './instance';
import type { NavActivity } from './session';

const KEY = 'joyofit.turnAlerts.route';

export interface ArmedRoute {
  routeId: string;
  name: string;
}

/** Huawei sport types with GPS on the watch that a route makes sense for: 1 running, 2 walking, 3 cycling. */
export const ALERT_SPORTS: Readonly<Record<number, NavActivity>> = { 1: 'run', 2: 'walk', 3: 'ride' };

const listeners = new Set<() => void>();
let cached: ArmedRoute | null | undefined;

export function getArmedRoute(): ArmedRoute | null {
  if (cached !== undefined) return cached;
  try {
    const raw = Storage.getItemSync(KEY);
    cached = raw ? (JSON.parse(raw) as ArmedRoute) : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Arms `route` (null: none). One route at a time. */
export function setArmedRoute(route: ArmedRoute | null): void {
  cached = route;
  if (route) Storage.setItemSync(KEY, JSON.stringify(route));
  else Storage.removeItemSync(KEY);
  for (const l of listeners) l();
}

export function subscribeArmedRoute(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The watch workout the running alert session belongs to. */
let startedFor: number | null = null;

function log(message: string, error = false): void {
  pushLog({ ts: Date.now(), direction: error ? 'error' : 'info', serviceId: null, commandId: null, hex: null, message: `TurnAlerts: ${message}` });
}

/** Called with every `LiveWorkout` update (`LiveWorkoutProvider`): starts the alerts for an armed route, stops them when the workout ends. */
export async function syncTurnAlerts(live: LiveWorkout | null): Promise<void> {
  if (!turnAlertsAvailable()) return;
  const activity = isActive(live) && live.sportType !== null ? ALERT_SPORTS[live.sportType] : undefined;
  if (!isActive(live) || activity === undefined) {
    if (startedFor !== null && turnAlertSession.running) await turnAlertSession.stop('stopped');
    startedFor = null;
    return;
  }
  if (startedFor === live.id) return;
  const armed = getArmedRoute();
  if (armed === null || readWatchNavStatus()?.enabled !== true) return;
  // JoyoNavi navigation from the route page already gives the turns.
  if (watchNavSession.running) return;
  startedFor = live.id;
  const loaded = await loadRoute(armed.routeId);
  if (loaded === null) {
    log(`armed route ${armed.routeId} no longer exists`, true);
    setArmedRoute(null);
    return;
  }
  log(`watch workout ${live.sportName ?? live.sportType} started: alerts for "${loaded.route.name}"`);
  await turnAlertSession.start({ routeId: loaded.route.id, name: loaded.route.name, points: loaded.points, activity, reroute: true });
}
