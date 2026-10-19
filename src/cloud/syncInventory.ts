import Storage from 'expo-sqlite/kv-store';

import { cloudLog } from '@/cloud/log';
import { registerSyncedPref } from '@/cloud/prefsSync';
import { stableStringify } from '@/cloud/syncSnapshot';
import { errorMessage } from '@/format';
import { isLocale } from '@/i18n';
import { getLocalePref, setLocalePref } from '@/i18n/native';
import { defaultLayout } from '@/features/bikecomputer/fields/layout';
import { getFtp, setFtp } from '@/features/cycling/settings';
import { bikeSettingsStore, DEFAULT_BIKE_SETTINGS } from '@/features/bikecomputer/settings';
import { getWheelMm, setWheelMm } from '@/features/sensors/settings';
import { THEME_KEY } from '@/theme/ThemeProvider';
import { THEMES } from '@/theme/themes';
import { HuaweiWear, type CycleSwitches, type UserSex } from '@/wear';

/**
 * The preferences that follow the account (kind `pref`, see `prefsSync.ts`), and the reason for each one that does not.
 * A preference is in this list only if it reads and writes with no watch connected, on both platforms, and says the same
 * thing on every phone of one person.
 *
 * Synced (record id = key):
 *  - `theme`           kv `app_theme`. Kept by "delete this phone's data" (it is how this phone looks).
 *  - `locale`          kv `joyofit.locale`; absent = follow the phone. Kept by "delete this phone's data".
 *  - `goals`           ring goals and reminders (`getActivityGoals` / `setActivityGoals`).
 *  - `profile`         height, weight, birth year, sex, daily step goal (`getUserProfile` / `setUserProfile`).
 *  - `cycle`           the cycle calendar switch and its reminder switches (`getCycle()` overview / `setCycleEnabled`, `setCycleSwitches`).
 *  - `weather`         temperature unit and the chosen city's name (`getWeatherStatus` / `setWeatherUnit`, `setWeatherCity`).
 *  - `sleepreport`     the morning sleep report switch (`getSafety().sleepReportEnabled` / `setSleepReportEnabled`).
 *  - `healthyliving`   the Healthy Living switch (`getHealthyLiving().enabled` / `setHealthyLivingEnabled`).
 *  - `sync.cycle`      kv `cloud.syncCycle`: whether the menstrual log goes to the cloud (`healthSync.ts` owns the switch).
 *
 * Never synced, each because it belongs to this phone or its watch:
 *  - watch address, name, pairing and BLE keys, background service, force BLE, sync interval, per-watch settings
 *  - Wi-Fi only and automatic sync (each phone's data plan), update dismissals, push tokens, notification permission state
 *  - the battery help dismissal on the Watch tab (`joyofit.batteryHelp.dismissed`): it is about this phone's maker and Android version
 *  - Health Connect / Apple Health connection and export state
 *  - Android-only phone features: morning summary notification, notification forwarding and its app list, calls, find my phone,
 *    SOS relay (iOS cannot switch them on, and they act through this phone's permissions and SIM)
 *  - watch-held state: alarms, fall detection, automatic stress, heart-rate sensors and alerts, watch faces, photo face
 *  - experimental `courses` switch (Huawei-gated), the weather push switch / location mode / interval (they steer this phone's watch link)
 *  - family monitoring: `family_enabled` and `family_scope_*` are written by the app from the consents on the server, next to a
 *    device token and base URL that are per device
 *  - one-off flags: onboarding progress, GPS explainer, morning check-in dismissed day, course draft
 *  - Coach chat and the daily "how do you feel" check-in (a day's answer, not a preference); Strava link (server side)
 *  - Strength preferences (already in `strength_record`) and Sticker Studio / route data (`contentSync.ts`)
 *  - sticker share sheet toggles (route privacy, watermark): held in component state, never stored
 *
 * Another branch adds a preference with one `registerSyncedPref` call (see its comment).
 */

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object');
  return Object.fromEntries(Object.entries(value));
}

function int(doc: Json, key: string): number {
  const value = doc[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${key} is not an integer`);
  return value;
}

function flag(doc: Json, key: string): boolean {
  const value = doc[key];
  if (typeof value !== 'boolean') throw new Error(`${key} is not a boolean`);
  return value;
}

registerSyncedPref({
  key: 'theme',
  keepOnReset: true,
  async read() {
    const raw = await Storage.getItem(THEME_KEY);
    return THEMES.find((theme) => theme.id === raw)?.id;
  },
  async write(value) {
    const theme = THEMES.find((known) => known.id === value);
    if (!theme) throw new Error('unknown theme');
    await Storage.setItem(THEME_KEY, theme.id);
  },
  clear: async () => void (await Storage.removeItem(THEME_KEY)),
});

registerSyncedPref({
  key: 'locale',
  keepOnReset: true,
  read: async () => {
    const pref = getLocalePref();
    return pref === 'auto' ? undefined : pref;
  },
  write: async (value) => {
    if (!isLocale(value)) throw new Error('unknown language');
    setLocalePref(value);
  },
  clear: async () => setLocalePref('auto'),
});

const GOAL_DEFAULTS = { calories: 300, exerciseMinutes: 30, standHours: 12, remindStand: true, remindProgress: true, remindGoalReached: true };
const DEFAULT_STEPS = 10_000;

/** The ring's steps goal is the profile's daily goal until goals are saved, so that is the default steps number. */
function goalDefaults() {
  return { steps: HuaweiWear.getUserProfile()?.dailyStepGoal ?? DEFAULT_STEPS, ...GOAL_DEFAULTS };
}

registerSyncedPref({
  key: 'goals',
  // `setActivityGoals` also sets the profile's step goal.
  moves: ['profile'],
  read: async () => {
    const { steps, calories, exerciseMinutes, standHours, remindStand, remindProgress, remindGoalReached } = HuaweiWear.getActivityGoals();
    const goals = { steps, calories, exerciseMinutes, standHours, remindStand, remindProgress, remindGoalReached };
    return stableStringify(goals) === stableStringify(goalDefaults()) ? undefined : goals;
  },
  write: async (value) => {
    const doc = object(value);
    await HuaweiWear.setActivityGoals({
      steps: int(doc, 'steps'),
      calories: int(doc, 'calories'),
      exerciseMinutes: int(doc, 'exerciseMinutes'),
      standHours: int(doc, 'standHours'),
      remindStand: flag(doc, 'remindStand'),
      remindProgress: flag(doc, 'remindProgress'),
      remindGoalReached: flag(doc, 'remindGoalReached'),
    });
  },
  clear: async () => {
    await HuaweiWear.setActivityGoals(goalDefaults());
  },
});

const SEXES: readonly UserSex[] = ['male', 'female', 'unknown'];

registerSyncedPref({
  key: 'profile',
  // The ring's steps goal follows the profile's until goals are saved.
  moves: ['goals'],
  read: async () => {
    const stored = HuaweiWear.getUserProfile();
    if (!stored) return undefined;
    const { heightCm, weightKg, birthYear, sex, dailyStepGoal } = stored;
    return { heightCm, weightKg, birthYear, sex, dailyStepGoal };
  },
  write: async (value) => {
    const doc = object(value);
    const sex = SEXES.find((known) => known === doc.sex);
    const weightKg = doc.weightKg;
    if (typeof weightKg !== 'number' || !sex) throw new Error('bad profile');
    await HuaweiWear.setUserProfile({
      heightCm: int(doc, 'heightCm'),
      weightKg,
      birthYear: int(doc, 'birthYear'),
      sex,
      dailyStepGoal: int(doc, 'dailyStepGoal'),
    });
  },
  // The native module cannot forget a profile (null means "never saved" and sends nothing to the watch), and a placeholder
  // profile would be sent to a watch on connect. So a reset leaves it; a sign-in never uploads it into another account
  // unless the person chose that (`baselinePrefs`).
  clear: async () => {},
});

const CYCLE_DEFAULTS: CycleSwitches = { master: false, periodStart: true, periodEnd: true, fertileStart: true, fertileEnd: false, easyPregnancy: false };

function cycleSwitchesOf(source: CycleSwitches): CycleSwitches {
  const { master, periodStart, periodEnd, fertileStart, fertileEnd, easyPregnancy } = source;
  return { master, periodStart, periodEnd, fertileStart, fertileEnd, easyPregnancy };
}

registerSyncedPref({
  key: 'cycle',
  read: async () => {
    const { enabled, switches } = await HuaweiWear.getCycle();
    const picked = cycleSwitchesOf(switches);
    return !enabled && stableStringify(picked) === stableStringify(CYCLE_DEFAULTS) ? undefined : { enabled, switches: picked };
  },
  write: async (value) => {
    const doc = object(value);
    const switches = object(doc.switches);
    const next = cycleSwitchesOf({
      master: flag(switches, 'master'),
      periodStart: flag(switches, 'periodStart'),
      periodEnd: flag(switches, 'periodEnd'),
      fertileStart: flag(switches, 'fertileStart'),
      fertileEnd: flag(switches, 'fertileEnd'),
      easyPregnancy: flag(switches, 'easyPregnancy'),
    });
    const enabled = flag(doc, 'enabled');
    await HuaweiWear.setCycleSwitches(next);
    await HuaweiWear.setCycleEnabled(enabled);
  },
  clear: async () => {
    await HuaweiWear.setCycleSwitches(CYCLE_DEFAULTS);
    await HuaweiWear.setCycleEnabled(false);
  },
});

registerSyncedPref({
  key: 'weather',
  read: async () => {
    const { unit, city } = HuaweiWear.getWeatherStatus();
    const name = city?.name ?? null;
    return unit === 'celsius' && name === null ? undefined : { unit, city: name };
  },
  write: async (value) => {
    const doc = object(value);
    const { unit, city } = doc;
    if (unit !== 'celsius' && unit !== 'fahrenheit') throw new Error('unknown unit');
    await HuaweiWear.setWeatherUnit(unit);
    // Only the name travels: the phone looks the place up again, which needs the internet and may not find it. The unit
    // is already applied then, and the city stays what it was (the native module cannot forget one either).
    if (typeof city === 'string' && city.trim() !== '' && HuaweiWear.getWeatherStatus().city?.name !== city) {
      await HuaweiWear.setWeatherCity(city).catch((error: unknown) => cloudLog(`weather city "${city}" not set: ${errorMessage(error)}`, 'error'));
    }
  },
  clear: () => HuaweiWear.setWeatherUnit('celsius'),
});

registerSyncedPref({
  key: 'sleepreport',
  read: async () => (HuaweiWear.getSafety().sleepReportEnabled ? undefined : false),
  write: async (value) => {
    if (typeof value !== 'boolean') throw new Error('not a boolean');
    await HuaweiWear.setSleepReportEnabled(value);
  },
  clear: () => HuaweiWear.setSleepReportEnabled(true),
});

registerSyncedPref({
  key: 'healthyliving',
  read: async () => (HuaweiWear.getHealthyLiving().enabled ? undefined : false),
  write: async (value) => {
    if (typeof value !== 'boolean') throw new Error('not a boolean');
    await HuaweiWear.setHealthyLivingEnabled(value);
  },
  clear: () => HuaweiWear.setHealthyLivingEnabled(true),
});

// Same key and encoding as `CYCLE_KEY` in healthSync.ts: '0' = off, anything else (absent) = on, the default.
const CYCLE_SYNC_KEY = 'cloud.syncCycle';

registerSyncedPref({
  key: 'sync.cycle',
  read: async () => ((await Storage.getItem(CYCLE_SYNC_KEY)) === '0' ? false : undefined),
  write: async (value) => {
    if (typeof value !== 'boolean') throw new Error('not a boolean');
    await Storage.setItem(CYCLE_SYNC_KEY, value ? '1' : '0');
  },
  clear: async () => void (await Storage.removeItem(CYCLE_SYNC_KEY)),
});

// Bike computer mode (docs/bike-computer.md). Never synced: live tracking consent, downloaded offline maps, the battery history and the
// chosen route (they belong to this phone), and the e-bike mark per ride.
registerSyncedPref({
  key: 'ftp',
  read: async () => getFtp() ?? undefined,
  write: async (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('not a number');
    setFtp(value);
  },
  clear: async () => setFtp(null),
});

const WHEEL_KEY = 'joyofit.wheelMm';

registerSyncedPref({
  key: 'wheel',
  read: async () => ((await Storage.getItem(WHEEL_KEY)) === null ? undefined : getWheelMm()),
  write: async (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('not a number');
    setWheelMm(value);
  },
  clear: async () => void (await Storage.removeItem(WHEEL_KEY)),
});

registerSyncedPref({
  key: 'bike.settings',
  read: async () => {
    const settings = bikeSettingsStore.get();
    return stableStringify(settings) === stableStringify(DEFAULT_BIKE_SETTINGS) ? undefined : settings;
  },
  write: async (value) => {
    object(value);
    bikeSettingsStore.replace(value);
  },
  clear: async () => bikeSettingsStore.clear(),
});

registerSyncedPref({
  key: 'bike.layout',
  read: async () => {
    const layout = bikeSettingsStore.getLayout();
    return stableStringify(layout) === stableStringify(defaultLayout(false)) ? undefined : layout;
  },
  write: async (value) => {
    object(value);
    bikeSettingsStore.replaceLayout(value);
  },
  clear: async () => bikeSettingsStore.clearLayout(),
});
