/**
 * The app's one watch navigation session, wired to the real world: the `HuaweiWear` watch-nav functions, the phone's GPS through the sensor
 * hub (a workout session with GPS, started here only when none runs, so a recording that already runs keeps its own), the FOSSGIS OSRM
 * client of the route map (same 1.1 s queue and identity), and the in-app log.
 */
import { BleSensors } from '@/ble';
import { t } from '@/i18n';
import { routing } from '@/features/routes/map/services';
import { formatRouteDistance } from '@/features/routes/routeModel';
import { sensorHub } from '@/features/sensors/instance';
import { pushLog } from '@/state/logStore';
import { HuaweiWear, hasNative, type WatchNavStatus } from '@/wear';

import { TurnAlerts, type AlertStrings } from './alerts';
import { WATCH_NAV_CONFIG } from './config';
import type { PhoneMessage } from './messages';
import { WatchNavSession, type FixSource, type WatchNavNative } from './session';

/** The binary has the watch-nav functions (an OTA bundle on an older build has not). */
export function watchNavAvailable(): boolean {
  return hasNative('startWatchNav');
}

export function readWatchNavStatus(): WatchNavStatus | null {
  if (!watchNavAvailable()) return null;
  try {
    return HuaweiWear.getWatchNav();
  } catch {
    return null;
  }
}

const native: WatchNavNative = {
  start: (config) => HuaweiWear.startWatchNav(config),
  send: (json) => HuaweiWear.sendWatchNav(json),
  stop: () => HuaweiWear.stopWatchNav(),
  status: readWatchNavStatus,
  onEvent: (listener) => {
    const subscription = HuaweiWear.addListener('onWatchNav', listener);
    return () => subscription.remove();
  },
};

/** Fixes from the sensor hub; GPS runs in a workout session (foreground service on Android, background location on iOS) we own only if we started it. */
function createFixSource(title: () => string, text: () => string): FixSource {
  let owned = false;
  return {
    async start() {
      await sensorHub.start();
      if (BleSensors.isWorkoutSessionActive()) return;
      owned = true;
      await BleSensors.startWorkoutSession({ title: title(), text: text(), gps: true });
    },
    async stop() {
      if (!owned) return;
      owned = false;
      await BleSensors.endWorkoutSession();
    },
    onFix(listener) {
      return sensorHub.onLocation((e) => listener({ ts: e.ts, lat: e.lat, lon: e.lon, speedMps: e.speed, accuracy: e.accuracy }));
    },
  };
}

let notificationTitle = 'JoyoFit';
let notificationText = '';

/** The Android notification of the GPS session, in the app's language (set by the screen that starts navigation). */
export function setWatchNavNotification(title: string, text: string): void {
  notificationTitle = title;
  notificationText = text;
}

function alertStrings(): AlertStrings {
  return {
    action: (dir, exit) =>
      dir === 'roundabout' && exit !== undefined ? t('routes:watchNav.roundaboutExit', { exit }) : t(`routes:watchNav.dir.${dir}`),
    distance: formatRouteDistance,
    offRoute: t('routes:watchNav.alerts.offRoute'),
    offRouteBody: t('routes:watchNav.alerts.offRouteBody'),
    arrived: t('routes:watchNav.arrived'),
  };
}

/** The binary can send JoyoFit's own alerts to the watch (an OTA bundle on an older build cannot). */
export function turnAlertsAvailable(): boolean {
  return hasNative('sendWatchAlert');
}

/** The turn-alert session's output: the engine's messages become a few watch notifications (`alerts.ts`); there is no watch app to hear from. */
function createAlertNative(): WatchNavNative {
  let alerts: TurnAlerts | null = null;
  return {
    start: async () => {
      alerts = new TurnAlerts(alertStrings());
      return null;
    },
    send: async (json) => {
      const alert = alerts?.take(JSON.parse(json) as PhoneMessage) ?? null;
      if (alert === null) return true;
      const sent = await HuaweiWear.sendWatchAlert(alert.title, alert.body);
      pushLog({ ts: Date.now(), direction: sent ? 'info' : 'error', serviceId: null, commandId: null, hex: null, message: `TurnAlerts: ${sent ? 'sent' : 'not sent'} "${alert.title}"` });
      return sent;
    },
    stop: async () => {
      alerts = null;
    },
    status: () => null,
    onEvent: () => () => {},
  };
}

const sessionDeps = {
  routing,
  config: WATCH_NAV_CONFIG,
  now: Date.now,
  every: (fn: () => void, ms: number) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

/** Turns as watch notifications while the watch runs a workout with the route (`workoutAlerts.ts` starts and stops it). */
export const turnAlertSession = new WatchNavSession({
  ...sessionDeps,
  native: createAlertNative(),
  location: createFixSource(
    () => t('routes:watchNav.alerts.notificationTitle'),
    () => t('routes:watchNav.alerts.notificationText'),
  ),
  log: (message, error = false) =>
    pushLog({ ts: Date.now(), direction: error ? 'error' : 'info', serviceId: null, commandId: null, hex: null, message: `TurnAlerts: ${message}` }),
});

export const watchNavSession = new WatchNavSession({
  native,
  location: createFixSource(
    () => notificationTitle,
    () => notificationText,
  ),
  routing,
  config: WATCH_NAV_CONFIG,
  now: Date.now,
  every: (fn, ms) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  log: (message, error = false) =>
    pushLog({ ts: Date.now(), direction: error ? 'error' : 'info', serviceId: null, commandId: null, hex: null, message: `WatchNav: ${message}` }),
});
