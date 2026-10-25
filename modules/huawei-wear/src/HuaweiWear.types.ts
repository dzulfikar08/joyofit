import type { WatchMealLoggedEvent } from './HuaweiWearDiet.types';
import type { UploadProgressEvent, UploadResultEvent } from './HuaweiWearWatchface.types';
import type { FaceCustomization } from './HuaweiWearFaceCustom.types';
import type { HuaweiImportProgressEvent } from './HuaweiWearImport.types';

export type LinkState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'initializing'
  | 'connected'
  | 'syncing';

/** Authentication path negotiated from LinkParams.deviceSupportType + SecurityNegotiation.authType. */
export type AuthMode = 'normal' | 'hichain-lite' | 'hichain' | 'hichain3';

/**
 * How far JoyoFit gets with a watch model: `tested` on a real watch; `experimental` in Gadgetbridge's device list and on
 * the Bluetooth link JoyoFit speaks, never tried; `unknown` a Huawei or Honor name in no list, tried like a Huawei watch;
 * `unsupported` JoyoFit cannot talk to it (see `reason`).
 */
export type ModelSupport = 'tested' | 'experimental' | 'unknown' | 'unsupported';

export interface BondedDevice {
  address: string;
  name: string;
  /** The model the Bluetooth name belongs to ("Huawei Watch GT 4"); null when it is in no list. */
  model: string | null;
  support: ModelSupport;
  /** Why it is not `tested`, in a few words; null for tested models. */
  reason: string | null;
  /**
   * iOS only (undefined on Android): the watch was seen just now, advertising or held by iOS. False for the remembered watch that is out
   * of reach, or still linked to another phone, which then does not advertise.
   */
  nearby?: boolean;
  /** iOS only: iOS already holds a connection to this watch (paired in Settings > Bluetooth, or held by another app), so no scan shows it. */
  systemConnected?: boolean;
  /** Android: signal strength in dBm, only on a device the Bluetooth LE scan saw. */
  rssi?: number;
  /**
   * Android only: Android lists the device among its paired devices. False for a band (Android never pairs those), a device only a scan
   * saw, and a remembered watch whose Android pairing is gone. Undefined where it was not asked.
   */
  paired?: boolean;
  /** Android only: JoyoFit connected to this watch before. Its address and keys are stored, so Connect works without a scan finding it. */
  remembered?: boolean;
  /** Android only: a Classic (RFCOMM) model, which needs Android's own pairing. Undefined for a name in no list. */
  classic?: boolean;
}

export interface DeviceInfo {
  address: string;
  name: string;
  productModel: string | null;
  softwareVersion: string | null;
  hardwareVersion: string | null;
  serialNumber: string | null;
  batteryLevel: number | null;
  authMode: AuthMode;
  /** See `BondedDevice.model`. */
  model: string | null;
  support: ModelSupport;
}

/** `getSupportReport`: the summary is short enough for a GitHub issue link; the log is not. */
export interface SupportReport {
  /** App, phone, watch, supported commands and ExpandCapability, as plain text. */
  summary: string;
  /** The kept log lines, oldest first, as plain text. */
  log: string;
  /** Bluetooth name of the watch the report is about; null before any connect. */
  watch: string | null;
  model: string | null;
  support: ModelSupport;
}

/** One-minute activity sample from FitnessData step frames. Timestamps are unix seconds. */
export interface StepSample {
  timestamp: number;
  steps: number;
  /** Small calories (cal, 1/1000 kcal), as the watch's step frames count them. */
  calories: number;
  distance: number;
  heartRate: number | null;
  spo2: number | null;
  restingHeartRate: number | null;
}

export type SleepStage = 'light' | 'deep' | 'rem' | 'awake';

/**
 * Sleep segment as stored in the database; `type` is the raw watch sleep-state byte and `stage` the
 * decoded stage, null when the watch gave none.
 */
export interface SleepSegment {
  start: number;
  end: number;
  type: number;
  stage?: SleepStage | null;
}

export interface FitnessTotals {
  steps: number;
  /** kcal. */
  calories: number;
  distance: number;
}

/**
 * What one finished sync reports. The samples and sleep segments themselves are written to the
 * database by the native side; read them back with SQL.
 */
export interface SyncSummary {
  /** Start of the requested window, unix seconds. */
  from: number;
  /** End of the window (= new `device.last_sync`), unix seconds. */
  to: number;
  /** Number of step samples stored by this sync. */
  samples: number;
  /** Number of sleep segments stored by this sync. */
  sleep: number;
  /** Workouts stored (new, or completed after an earlier cut-off download) by this sync's workout phase. */
  workouts: number;
  /** Today's totals as reported by the watch. */
  totals: FitnessTotals;
  /**
   * The watch the sync ran on (`device.address`). Android names it (a background visit syncs a watch that is not the one the app shows);
   * absent on iOS and on older binaries, where the watch the link is up to is the one.
   */
  address?: string | null;
}

/** What happened to one workout of `refetchWorkoutData`. */
export type WorkoutRefetchOutcome =
  /** The watch sent running form and the stored summary now has it. */
  | 'updated'
  /** The watch sent running form and the summary already had exactly that. */
  | 'unchanged'
  /** The watch still has the workout, but its samples carry no running form. */
  | 'no_dynamics'
  /** The watch no longer lists the workout (or this phone has no copy this watch recorded). */
  | 'gone'
  /** The watch did not answer usably or the workout could not be stored; asking again may work. */
  | 'failed';

/** What `refetchWorkoutData` did, in counts and per requested start. */
export interface WorkoutRefetchReport {
  requested: number;
  updated: number;
  unchanged: number;
  noDynamics: number;
  gone: number;
  failed: number;
  /** One entry per requested start, in the order asked. */
  results: { start: number; outcome: WorkoutRefetchOutcome }[];
}

export type LogDirection = 'tx' | 'rx' | 'info' | 'error';

export interface LogEvent {
  ts: number;
  direction: LogDirection;
  serviceId: number | null;
  commandId: number | null;
  hex: string | null;
  message: string;
}

export interface StateEvent {
  state: LinkState;
  error: string | null;
}

export interface BatteryEvent {
  level: number;
}

/** Emitted after every stored sync, including syncs run by the background service. */
export interface SyncCompleteEvent extends SyncSummary {}

/** Background connection settings and service state. */
export interface BackgroundStatus {
  /** The foreground service keeps the watch connected and syncs on a timer. */
  enabled: boolean;
  /** The remembered watch: the last one connected or enabled for background, or null. */
  address: string | null;
  /** Name of the remembered watch. */
  name: string | null;
  /** The foreground service is running right now. */
  running: boolean;
  /**
   * Auto-reconnect is paused because the user disconnected in the app. Connecting again (or
   * toggling background off and on) resumes it.
   */
  paused: boolean;
  syncIntervalMinutes: number;
}

/** The phone makers whose Android keeps its own list of apps allowed to start by themselves (`BackgroundRestrictions.autoStartVendor`). */
export type AutoStartVendor = 'transsion' | 'xiaomi' | 'oppo' | 'vivo';

/**
 * Whether Android may stop the background service while the screen is off, which drops the watch link (`getBackgroundRestrictions`,
 * Android only). Exempt and unrestricted means the phone leaves the connection alone.
 */
export interface BackgroundRestrictions {
  /** JoyoFit is on Android's battery optimization exemption list (Doze and App Standby leave its connection alone). */
  ignoringBatteryOptimizations: boolean;
  /** The app is under "Restricted" background use (Android 9+): it may not run in the background at all. */
  backgroundRestricted: boolean;
  /** `Build.MANUFACTURER`, for display and the support report. */
  manufacturer: string;
  /** The group of makers (Infinix/Tecno/itel, Xiaomi, OPPO/realme, vivo) whose auto-start list `openAutoStartSettings` tries to open; null for any other maker. */
  autoStartVendor: AutoStartVendor | null;
  /**
   * The build may show Android's own "allow" dialog for the exemption (sideload APK). The Google Play build cannot (Play does not allow the
   * prompt for an app like this one): `openBatteryExemption` opens Android's battery optimization list instead.
   */
  canRequestDirectly: boolean;
}

export interface NotificationAccessStatus {
  /** The user granted notification access to this app in Android settings. */
  granted: boolean;
  /** Forwarding to the watch is switched on. */
  enabled: boolean;
}

/** An installed launcher app and whether its notifications are forwarded. */
export interface NotificationApp {
  packageName: string;
  label: string;
  enabled: boolean;
  /** file:// URI of a cached 96 px PNG of the app icon; absent when it could not be rendered. */
  iconUri?: string | null;
}

export type UserSex = 'male' | 'female' | 'unknown';

/** Profile and goal sent to the watch. */
export interface UserProfile {
  heightCm: number;
  weightKg: number;
  birthYear: number;
  sex: UserSex;
  dailyStepGoal: number;
}

/** How the connected watch takes heart-rate zones: `track` over P2P (ExpandCapability 0x36), `extended` FitnessData 07/21, `simple` 07/13, `none` for a watch that takes neither. */
export type HeartRateZonesRoute = 'track' | 'extended' | 'simple' | 'none';

/**
 * The heart-rate zones JoyoFit sends to the watch for its workout screen (Huawei Health's "Heart rate zones": calculation method, maximum
 * heart rate, resting heart rate, the five zone limits and the heart-rate limit alert). The app computes the zones; the watch gets the
 * result as it is, so both show the same numbers.
 */
export interface HeartRateZonesConfig {
  /** `max`: percentage of maximum heart rate (Huawei code 0); `hrr`: percentage of heart rate reserve (Huawei code 1). Decides which set the watch uses. */
  method: 'max' | 'hrr';
  /** 100..219 bpm. */
  maxHr: number;
  /** 30..110 bpm. */
  restingHr: number;
  /** The lowest bpm of zones 1 to 5, five whole numbers, strictly rising, each at least 30 and below `maxHr`. */
  zones: number[];
  /** The watch's heart-rate limit alert during a workout. */
  warningEnabled: boolean;
  /** The bpm that raises the alert, 100..219. */
  warningLimit: number;
}

/** What the native module holds and how the connected watch takes zones. `via` is null while no watch is connected. */
export interface HeartRateZonesStatus {
  /** True when a configuration was stored with `setHeartRateZones`; false means the defaults for the profile's age are sent. */
  configured: boolean;
  via: HeartRateZonesRoute | null;
}

export type HealthConnectAvailability = 'available' | 'update-required' | 'unavailable';

/**
 * Health Connect record types JoyoFit writes; also the names in `granted` / `missing`. `ExerciseRoute` (Android only) is the
 * permission to attach a workout's GPS route to its exercise session, not a record type of its own.
 */
export type HealthConnectRecordType =
  | 'Steps'
  | 'HeartRate'
  | 'OxygenSaturation'
  | 'RestingHeartRate'
  | 'Distance'
  | 'ActiveCaloriesBurned'
  | 'SleepSession'
  | 'ExerciseSession'
  | 'ExerciseRoute';

/** State of the Health Connect export (write only; JoyoFit never reads Health Connect). */
export interface HealthConnectStatus {
  /** `update-required`: the Health Connect app on the phone must be updated first. */
  availability: HealthConnectAvailability;
  /** Every sync is written to Health Connect (set by `setHealthConnectEnabled`). */
  enabled: boolean;
  /** Record types with write permission. */
  granted: HealthConnectRecordType[];
  /** Record types without write permission; these are skipped by the export. */
  missing: HealthConnectRecordType[];
  /** An export is running right now. */
  exporting: boolean;
  /** Unix seconds of the last export that finished without error, or null. */
  lastExportSec: number | null;
  /** Why the last export failed, or null. */
  lastError: string | null;
  /** What the last export wrote, e.g. `steps=120 distance=120 ... workouts=1`, or null. */
  lastCounts: string | null;
}

/** Records written by one Health Connect export (a backfill). */
export interface HealthConnectExportResult {
  steps: number;
  distance: number;
  calories: number;
  heartRate: number;
  spo2: number;
  restingHeartRate: number;
  sleep: number;
  workouts: number;
}

export type TemperatureUnit = 'celsius' | 'fahrenheit';

/** `current`: the phone's coarse location. `city`: the city chosen with `setWeatherCity`. */
export type WeatherLocationMode = 'current' | 'city';

/** A city found by Open-Meteo geocoding. */
export interface WeatherPlace {
  /** Shown on the watch; null for a current position that could not be named. */
  name: string | null;
  latitude: number;
  longitude: number;
  /** Region and country, e.g. "West Java, Indonesia". */
  detail: string | null;
}

/**
 * What the forecast step (`0f/08`) of the last weather push did. The watch lists the command in its supported commands or it
 * does not (`unsupported`: the push is current weather only); a listed one can answer with the OK code, answer with another
 * code (`rejected`) or not answer within the timeout (`unacknowledged`).
 */
export type WeatherForecastState = 'sent' | 'unsupported' | 'unacknowledged' | 'rejected';

export interface WeatherForecastStatus {
  state: WeatherForecastState;
  /** Hourly and daily entries in the request; 0 when nothing was sent. */
  hours: number;
  days: number;
  /** Tag 0x7f of the watch's answer (100000 is OK), or null when it did not answer. */
  replyCode: number | null;
  /** Unix seconds of the attempt. */
  at: number;
}

/** Weather settings and what the last push to the watch did. */
export interface WeatherStatus {
  /** Off by default: weather needs the internet and the phone's location. */
  enabled: boolean;
  unit: TemperatureUnit;
  locationMode: WeatherLocationMode;
  /** Minutes between pushes while the watch is connected (default 60). */
  intervalMinutes: number;
  /** The chosen city, used when `locationMode` is `city`. */
  city: WeatherPlace | null;
  /** ACCESS_COARSE_LOCATION (or fine) is granted. Needed for `current`. */
  locationPermission: boolean;
  /** The connected watch lists the weather service; null when no watch is connected. */
  watchSupported: boolean | null;
  /** Unix seconds of the last push that reached the watch in this process, or null. */
  lastPushAt: number | null;
  /** Why the last attempt failed, or null. */
  lastError: string | null;
  /** Temperature of the last push, whole degrees Celsius. */
  lastTemperatureC: number | null;
  /** Huawei icon name of the last push, e.g. `SUNNY`, `LIGHT_RAIN`. */
  lastCondition: string | null;
  lastLocationName: string | null;
  /** The forecast step of the last push in this process, or null before the first one. */
  lastForecast: WeatherForecastStatus | null;
}

/** A live heart-rate reading the watch pushed (`onHeartRate`); only while `setLiveHeartRate(true)` is in effect. */
export interface HeartRateEvent {
  bpm: number;
  /** Unix milliseconds, the phone's receive time. */
  ts: number;
}

/**
 * One 1-minute HRV measurement (`measureHrv`). Times are Unix seconds, intervals milliseconds. Computed on the phone from
 * the watch's beat-to-beat (RR) intervals after artifacts are dropped; also stored as a `spot` row in `hrv_readings`.
 */
export interface HrvReading {
  start: number;
  end: number;
  /** Root mean square of successive differences, ms: the vagal-tone number recovery is scored from. */
  rmssd: number;
  /** Standard deviation of the intervals, ms. */
  sdnn: number;
  /** Mean beat-to-beat interval, ms. */
  meanRr: number;
  /** Clean beats the numbers are computed from. */
  beats: number;
  /** Mean heart rate over the minute, bpm (from `meanRr`). */
  heartRate: number;
}

/** `onHrvProgress`: the minute counts down while the watch sends intervals. */
export interface HrvProgressEvent {
  secondsLeft: number;
  /** Intervals received so far with a usable signal. */
  beats: number;
}

/** The watch's automatic stress switch (`getStressStatus`, `setAutomaticStress`). */
export interface StressStatus {
  /** As last set from this app; the watch has no query for it. */
  enabled: boolean;
  /** Unix seconds of the calibration the watch was last given; null when none was stored. */
  lastCalibratedAt: number | null;
  /** The connected watch lists the automatic stress command (20/09); false while no watch is connected. */
  supported: boolean;
  /** Whether the watch listed the command the last time it connected, kept across restarts; null before any connect. */
  knownSupported: boolean | null;
}

/** Which sensor commands the connected watch lists (Gadgetbridge's `HuaweiState.supports*`). */
export interface HealthSensorSupport {
  heartRate: boolean;
  realtimeHeartRate: boolean;
  spo2: boolean;
  truSleep: boolean;
  highHeartRateAlert: boolean;
  lowHeartRateAlert: boolean;
}

/** What the watch's health sensors are set to. Everything but the alerts is on by default, as in Huawei Health. */
export interface HealthSensorsUpdate {
  /** Continuous heart rate: the watch records a reading about every minute. Without it, no heart rate reaches the app. */
  automaticHeartRate: boolean;
  /** Automatic SpO2 readings. */
  automaticSpo2: boolean;
  /** TruSleep, the sleep tracking the sleep files come from. */
  truSleep: boolean;
  /** bpm that triggers an alert on the watch; 0 = off, else 100 to 150. */
  highHeartRateAlert: number;
  /** bpm that triggers an alert on the watch; 0 = off, else 40 to 50. */
  lowHeartRateAlert: number;
}

export interface HealthSensorsStatus extends HealthSensorsUpdate {
  /** What the connected watch supports; null when no watch is connected (nothing is known then). */
  supported: HealthSensorSupport | null;
}

/**
 * Where a watch-started workout is: `preparing` (the watch is still searching for GPS or counting down; the phone's timer
 * waits), recording, paused, or finished.
 */
export type LiveWorkoutStatus = 'preparing' | 'running' | 'paused' | 'ended';

/** A fix of the phone's GPS as the live screen's map needs it. `accuracy` (m) and `bearing` (deg) are null when the platform gave none. */
export interface LiveLocation {
  lat: number;
  lon: number;
  accuracy: number | null;
  bearing: number | null;
}

/**
 * A workout started on the watch, followed live (`getLiveWorkout`, `onLiveWorkout`). The watch pushes its numbers
 * about every second; every metric is null until it has sent one.
 */
export interface LiveWorkout {
  /** Phone time (Unix ms) the workout was first seen; changes with every new workout. */
  id: number;
  status: LiveWorkoutStatus;
  /**
   * `watch`: the watch's own numbers. `gps` / `status` / `manual`: JoyoFit's session on the watch's realtime heart rate,
   * started because the watch asked for the phone's GPS, because its status said a workout runs, or by hand; the phone
   * counts the time (from the moment the watch says the workout runs) and estimates the calories.
   */
  source: 'watch' | 'gps' | 'status' | 'manual';
  /** Huawei sport type (1 running, 2 walking, 3 cycling, 5 indoor running, 7 indoor cycling, 13 indoor walking ...). */
  sportType: number | null;
  sportName: string | null;
  /** Unix ms of the last change, phone time. */
  updatedAt: number;
  endedAt: number | null;
  /** Workout time on the watch, seconds (pauses excluded), as of `updatedAt`. */
  durationSec: number | null;
  heartRate: number | null;
  /** Heart-rate zone as the watch numbers it (unverified). */
  heartRateZone: number | null;
  /** 220 - age from the profile (35 when none is saved); the fat and carb estimate uses it. */
  maxHeartRate: number;
  distanceM: number | null;
  /** kcal burned in the workout. */
  calories: number | null;
  activeCalories: number | null;
  speedKmh: number | null;
  paceSecPerKm: number | null;
  /** Steps per minute. */
  stepRate: number | null;
  steps: number | null;
  /** Cycling cadence, rpm. */
  cadence: number | null;
  altitudeM: number | null;
  riseM: number | null;
  descentM: number | null;
  aerobicTe: number | null;
  anaerobicTe: number | null;
  /** JoyoFit's estimate (the watch sends no such figure): grams of fat and carbohydrate burned so far. */
  fatGrams: number;
  carbGrams: number;
  /** Share of energy from fat at the current heart rate, 0 to 1, same estimate. */
  fatShare: number | null;
  /**
   * The watch looks to have stopped without saying so (it still asks for GPS but reports no workout, or went quiet): the
   * screen asks the user to finish or keep going. Absent from builds before the watch-status timer.
   */
  endSuspected?: boolean;
  /**
   * The clock of a phone-side session (`source` `gps` / `status`) was started by a word from the watch (its status, a report); false when it
   * was started only because the person moved (a watch that gives no sign of its start). Absent from builds before the pre-start fix:
   * those could start the clock from the first GPS request, which the JS side cannot tell apart.
   */
  clockConfirmed?: boolean;
  /** The watch asked for the phone's GPS during this workout: an outdoor sport, whatever sport tag it sent. Absent from older builds (`source` `gps` says the same). */
  gpsRequested?: boolean;
  /** The phone's last GPS fix (it runs from the watch's first GPS request to the end of the workout), null before the first. Absent from older builds. */
  location?: LiveLocation | null;
  /** GPS time (Unix ms) of `location`. */
  locationAt?: number | null;
  /** The phone's own distance, climb and pace from its fixes while the workout ran; what the screen shows when the watch sends none. Null before the first fix. */
  gpsDistanceM?: number | null;
  gpsRiseM?: number | null;
  gpsPaceSecPerKm?: number | null;
}

/** Huawei sport code of strength training (Gadgetbridge's sport table; `WorkoutSportTypes.kt`). */
export const WATCH_SPORT_STRENGTH_TRAINING = 140;

/**
 * What a start, pause, resume or stop sent to the watch came to (`startWatchWorkout` ...). `confirmed`: the watch accepted it (a start:
 * and reports the workout running). `sent`: the command went out and the watch did not confirm it (no answer, or a start its status
 * does not show). `refused`: the watch answered with an error `code`. `unsupported`: the watch does not list the command.
 * `not_connected`: no watch link.
 */
export type WatchWorkoutOutcome = 'confirmed' | 'sent' | 'refused' | 'unsupported' | 'not_connected';

export interface WatchWorkoutResult {
  outcome: WatchWorkoutOutcome;
  /** The watch's result code when it sent one (100000 accepts), else null. */
  code: number | null;
  /**
   * Android only: the wear state the watch reported right after a refusal (DeviceConfig `01/3D`): false is "not on the wrist", true is worn,
   * null when it was not asked or the watch did not say. Absent on iOS and on a binary older than that change.
   */
  worn?: boolean | null;
}

/** `getWatchWorkout`: whether the connected watch can be told to start a workout, and the workout the phone started on it. */
export interface WatchWorkoutStatus {
  connected: boolean;
  /** The watch lists the phone-started workout command (`17/01`). */
  supported: boolean;
  /** A workout started from the phone is open (until its stop, or a stop on the watch). */
  active: boolean;
  sport: number | null;
  state: 'running' | 'paused' | null;
  /** The last operator the watch itself reported (1 start, 2 pause, 3 resume, 4 stop); null when none. */
  watchOperator: number | null;
}

export type HuaweiWearModuleEvents = {
  onStateChange: (event: StateEvent) => void;
  onBattery: (event: BatteryEvent) => void;
  onLog: (event: LogEvent) => void;
  onUploadProgress: (event: UploadProgressEvent) => void;
  onUploadResult: (event: UploadResultEvent) => void;
  onSyncComplete: (event: SyncCompleteEvent) => void;
  onHeartRate: (event: HeartRateEvent) => void;
  onWatchMealLogged: (event: WatchMealLoggedEvent) => void;
  /** The watch reported a face's options without being asked, e.g. the user edited the face on the watch. */
  onFaceCustomization: (event: FaceCustomization) => void;
  /** A workout started on the watch changed state or pushed new numbers. */
  onLiveWorkout: (event: LiveWorkout) => void;
  /** Once a second while `measureHrv` or the calibration of `setAutomaticStress` runs. */
  onHrvProgress: (event: HrvProgressEvent) => void;
  /** While `importHuaweiExport` runs: at most four times a second, then once with `phase: 'done'`. */
  onHuaweiImportProgress: (event: HuaweiImportProgressEvent) => void;
  onDeviceDiscovered: (event: BondedDevice) => void;
  onScanStateChange: (event: { scanning: boolean; error: string | null }) => void;
};
