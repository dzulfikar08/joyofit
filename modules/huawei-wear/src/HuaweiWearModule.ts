import { NativeModule, requireNativeModule } from 'expo';
import type {
  BackgroundStatus,
  BondedDevice,
  DeviceInfo,
  HealthConnectExportResult,
  HealthConnectStatus,
  HealthSensorsStatus,
  HealthSensorsUpdate,
  HrvReading,
  HuaweiWearModuleEvents,
  LinkState,
  LiveWorkout,
  NotificationAccessStatus,
  NotificationApp,
  StressStatus,
  SupportReport,
  SyncSummary,
  UserProfile,
  WeatherLocationMode,
  WeatherPlace,
  WeatherStatus,
} from './HuaweiWear.types';
import type { PhoneFeatures, WatchAlarms, WatchAlarmsUpdate } from './HuaweiWearPhone.types';
import type {
  AgpsRefreshResult,
  AgpsStatus,
  CycleOverview,
  CycleSwitches,
  SafetyStatus,
  SosRelayTest,
} from './HuaweiWearExtras.types';
import type {
  ActivityGoals,
  ActivityGoalsStatus,
  BodyMetrics,
  BodyMetricsUpdate,
  DietDay,
  DietStatus,
} from './HuaweiWearDiet.types';
import type { ParsedWatchfacePackage, WatchfaceInstallResult, WatchfaceList } from './HuaweiWearWatchface.types';
import type { FaceApplyResult, FaceCustomization } from './HuaweiWearFaceCustom.types';
import type { PhotoFace } from './HuaweiWearPhotoFace.types';
import type { CoursesStatus, HealthyLivingStatus, RunningCourse, RunningCoursePushResult } from './HuaweiWearP2p.types';
import type { RoutePushResult, RoutesStatus, WatchRoute } from './HuaweiWearRoutes.types';
import type { HuaweiImportSummary } from './HuaweiWearImport.types';
import type { FamilyConfig, FamilyUploadResult, FamilyUploadStatus } from './HuaweiWearFamily.types';

declare class HuaweiWearModule extends NativeModule<HuaweiWearModuleEvents> {
  /**
   * Which build this is. `play` (Google Play) has no SEND_SMS, READ_CALL_LOG or READ_CONTACTS, so SOS texts and caller
   * names are not available; `sideload` is the APK from the website or a self-build. Set by `JOYOFIT_DISTRIBUTION` at build time.
   */
  readonly distribution: 'play' | 'sideload';
  /**
   * Bonded Bluetooth devices, each with the support level of its model. Requires BLUETOOTH_CONNECT on Android 12+. The watch JoyoFit
   * remembers is always in the list (Android: `remembered`, with `paired` false when Android does not list it as paired), so it can be
   * connected by its stored address without a scan finding it.
   */
  getBondedDevices(): Promise<BondedDevice[]>;
  /**
   * Android only (iOS rejects ERR_UNSUPPORTED: its list scans by itself, see `refreshBondedDevices`): scans for nearby Huawei and Honor
   * BLE devices, for up to 12 s, emitting `onDeviceDiscovered` and `onScanStateChange`. Needs BLUETOOTH_SCAN (Android 12+, declared
   * neverForLocation, no location permission) and rejects ERR_BLUETOOTH_PERMISSION without it. A scan only lists devices; nothing connects
   * or binds. A watch that is linked to another phone or app does not advertise and is not found.
   */
  startScan(): Promise<void>;
  /** Stops any ongoing Bluetooth LE scan (a no-op on iOS). */
  stopScan(): Promise<void>;
  /** Android: the devices the latest scan saw; empty on iOS. */
  getDiscoveredDevices(): BondedDevice[];
  /**
   * `getBondedDevices` again, for the Refresh button: on iOS (which has no bonded list: the remembered watch, the watches iOS already
   * holds a connection to, and the ones advertising) it ignores the last scan and scans longer; on Android it is the same list.
   */
  refreshBondedDevices(): Promise<BondedDevice[]>;
  /**
   * RFCOMM or BLE GATT connect (by model) + LinkParams + auth + init. Resolves when `connected`. There is one link per
   * process: if the background service is already connecting to or connected with this watch, this
   * joins that link. A successful connect remembers the watch for background mode and resumes a
   * paused auto-reconnect. A first bind (the watch does not know this phone) replaces the watch's current phone pairing, so it never
   * starts by itself: connect rejects `ERR_BIND_CONFIRMATION` before anything changes on the watch, and only a connect that follows
   * `confirmBind(address)` binds. Other failures: `ERR_CONNECT_FAILED`, `ERR_TIMEOUT`, `ERR_DISCONNECTED`, `ERR_AUTH_FAILED`, and on
   * Android `ERR_NOT_PAIRED` (a Classic watch that could not be reached while Android has no pairing with it; nothing is removed or reset).
   */
  connect(address: string): Promise<DeviceInfo>;
  /** The user agreed to bind this phone to the watch: the next `connect(address)` may start a first bind. Single use. */
  confirmBind(address: string): void;
  /** Closes the link. With background mode on, this also pauses auto-reconnect. */
  disconnect(): Promise<void>;
  getState(): LinkState;
  /** The connected watch (also when the background service connected it), or null. */
  getDevice(): DeviceInfo | null;
  /**
   * For people who add support for a watch: app, phone, the last watch (model, software, supported commands,
   * ExpandCapability) and the log of its last connect plus the newest lines. Bluetooth addresses and the serial number
   * are left out. Works without a connected watch.
   */
  getSupportReport(): Promise<SupportReport>;
  refreshBattery(): Promise<number>;
  /**
   * Pulls sleep, steps and today's totals since the last stored sync (everything the watch still holds on the first
   * sync, otherwise 1 h before `device.last_sync`), writes them to the database and resolves with a summary.
   */
  syncActivity(): Promise<SyncSummary>;
  /**
   * Pulls everything the watch still holds (activity, sleep, workouts, and on Android night HRV) again, regardless of
   * `device.last_sync`. Rows already stored are upserted, so only what is missing is added.
   */
  syncFullHistory(): Promise<SyncSummary>;
  /** Drops the stored auth key / fake identity so the next connect performs a first-time bind. */
  forgetDevice(address: string): Promise<void>;

  /**
   * One-time import of the history in a Huawei Privacy Centre "Request Your Data - Health" ZIP, read on the
   * phone and written to the database; nothing is sent anywhere. `uri` is a `content://` (Android) or `file://` URI of
   * the ZIP, opened in place (on iOS: a security-scoped URL from the document picker), `password` the one set when the
   * data was requested (it is held in memory for the run only). Progress arrives as
   * `onHuaweiImportProgress`. Watch data already on the phone is never overwritten and importing the same file again adds
   * nothing; imported rows carry `imported = 1` and stay out of the cloud upload, Health Connect / Apple Health and Strava. Rejects with
   * ERR_IMPORT_PASSWORD (wrong or missing password), ERR_IMPORT_FORMAT (not a ZIP, or no Health data folders), ERR_BUSY
   * (an import is running) or ERR_STORAGE.
   */
  importHuaweiExport(uri: string, password: string): Promise<HuaweiImportSummary>;
  /**
   * iOS only (not defined on Android): the one-time import of the history Huawei Health wrote into Apple Health. Asks for READ
   * permission for steps, heart rate, resting heart rate, blood oxygen, sleep, workouts and active energy when called (the system sheet
   * shows the first time only), then reads window by window, oldest first, skipping samples JoyoFit wrote itself. Rows carry
   * `imported = 1` like the ZIP import; the same rules apply (watch data wins, a second run adds nothing). Progress arrives as
   * `onHuaweiImportProgress` (`fileName` null, `fileCount` 0). Nothing read leaves the phone. Rejects with ERR_UNSUPPORTED (no Health
   * data on this device), ERR_BUSY or ERR_STORAGE, or with the HealthKit error when the permission sheet fails.
   */
  importAppleHealthHistory(): Promise<HuaweiImportSummary>;
  /** Stops a running import (ZIP or Apple Health) between two records; the promise resolves with `cancelled: true`. Rows written so far stay. */
  cancelHuaweiImport(): void;

  /**
   * Starts the foreground service for `address` (auto-connect, auto-reconnect, periodic sync), or
   * stops it when `address` is null. Requires BLUETOOTH_CONNECT; ask for POST_NOTIFICATIONS first
   * on Android 13+ or the service notification is hidden.
   */
  setBackgroundEnabled(address: string | null): Promise<void>;
  getBackgroundStatus(): BackgroundStatus;
  /**
   * Closes the native connection to `joyofit.db` and keeps it closed (native reads and writes fail with ERR_STORAGE) until
   * `resumeDatabase`; waits for a transaction that is running. The repair of a damaged file calls it before it replaces the file.
   * Gate on `hasNative`: binaries older than the shared-SQLite change do not have it.
   */
  releaseDatabase(): Promise<void>;
  /** Lets the native side open `joyofit.db` again after `releaseDatabase`. */
  resumeDatabase(): Promise<void>;
  /** 5 to 1440 minutes. */
  setSyncIntervalMinutes(minutes: number): Promise<void>;

  /** Opens Android's notification access screen for this app. */
  openNotificationAccess(): Promise<void>;
  getNotificationAccess(): NotificationAccessStatus;
  setNotificationsEnabled(enabled: boolean): Promise<void>;
  /**
   * Developer switch: the next connect opens Bluetooth LE GATT (service 0xFE86) instead of the model's own link (RFCOMM for the
   * Fit 4 Pro). Off by default; needs BLUETOOTH_SCAN to find the watch's LE address, else it tries the bonded address.
   */
  getForceBle(): boolean;
  setForceBle(enabled: boolean): Promise<void>;
  /** The once-a-day "Morning summary" notification, posted after the first sync that stored last night's sleep. Off by default. */
  getMorningSummaryEnabled(): boolean;
  setMorningSummaryEnabled(enabled: boolean): Promise<void>;
  /** Launcher apps with their forwarding state. Apps without an explicit choice are on unless they are system apps. */
  getNotificationApps(): Promise<NotificationApp[]>;
  setNotificationAppEnabled(packageName: string, enabled: boolean): Promise<void>;

  /** The stored profile, or null if the user never saved one (nothing is sent to the watch then). */
  getUserProfile(): UserProfile | null;
  /**
   * Stores the profile and goal and, if the watch is connected, sends them now. Resolves true when
   * they reached the watch, false when stored only (not connected or unsupported).
   */
  setUserProfile(profile: UserProfile): Promise<boolean>;

  /** The sensor switches as stored, plus what the connected watch supports (`supported` is null when none is connected). */
  getHealthSensors(): HealthSensorsStatus;
  /**
   * Stores the sensor switches and, if the watch is connected, sends what changed. Resolves true
   * when everything reached the watch, false when stored only or the watch did not answer. On every
   * connect the stored switches (not alerts that are off) are sent too. Rejects with
   * ERR_INVALID_ARGUMENT for an alert threshold the watch does not offer.
   */
  setHealthSensors(sensors: HealthSensorsUpdate): Promise<boolean>;
  /**
   * Asks the watch for live heart rate (`true`) and emits `onHeartRate` for every reading it pushes, or
   * stops that (`false`) and restores the continuous heart-rate setting. It costs watch battery: call it
   * only while the live number is on screen. The module also stops it when the app goes to the background.
   * Does nothing when no watch is connected or it does not list the realtime command.
   */
  setLiveHeartRate(active: boolean): Promise<void>;

  /**
   * Measures HRV for one minute from the watch's realtime beat-to-beat intervals (19/01 {01: 3}, pushes 19/05), computes
   * RMSSD and SDNN, stores a `spot` row in `hrv_readings` and resolves with it. Live heart rate is paused meanwhile and
   * restored. Emits `onHrvProgress` every second. Rejects with ERR_NOT_CONNECTED, ERR_UNSUPPORTED (no 19/01), ERR_BUSY (a
   * measurement or live workout is using the sensor), ERR_DISCONNECTED, ERR_HRV_CANCELLED, or ERR_HRV_TOO_FEW_BEATS when
   * fewer than 40 beats had a clean signal (the message says how many).
   */
  measureHrv(): Promise<HrvReading>;
  /** Ends a running `measureHrv` early; it rejects with ERR_HRV_CANCELLED. Does nothing when none is running. */
  cancelHrvMeasurement(): Promise<void>;
  /** The automatic stress switch as last set from the app, and whether the connected watch lists the command. */
  getStressStatus(): StressStatus;
  /**
   * Turns the watch's automatic stress on or off (20/09). On: runs the 1-minute measurement (as `measureHrv`, and keeps
   * its reading), computes the calibration Gadgetbridge computes and sends it; takes about a minute and the user has to
   * sit still. The switch and the calibration are stored and sent again on every connect. Off: sends status 2.
   * Rejects like `measureHrv`, plus ERR_STRESS_CALIBRATION (the minute could not be scored) and ERR_STRESS_REJECTED (the
   * watch answered with an error code).
   */
  setAutomaticStress(enabled: boolean): Promise<StressStatus>;

  /** The workout started on the watch that is running now, or the last one until dismissed; null when none was seen. */
  getLiveWorkout(): LiveWorkout | null;
  /** Forgets a finished live workout (status `ended`) and removes its notification. */
  dismissLiveWorkout(): void;
  /** Starts a phone-side live session on the watch's realtime heart rate (for indoor workouts the watch does not announce). */
  startLiveWorkout(): void;
  /** Ends the live session now. */
  finishLiveWorkout(): void;

  /**
   * Makes the watch ring and vibrate (`start` true) or stops it. Needs a connected watch that
   * reports find-device support (ERR_UNSUPPORTED otherwise, ERR_NOT_CONNECTED when disconnected).
   * The command is fire-and-forget like Gadgetbridge's: it resolves once sent.
   */
  findWatch(start: boolean): Promise<void>;
  /** Switches, permission state and find-watch support for find my phone and calls. */
  getPhoneFeatures(): PhoneFeatures;
  /** When on, the watch's find-my-phone button rings this phone (background service included). Off also silences a ringing phone. */
  setFindPhoneEnabled(enabled: boolean): Promise<void>;
  /** Show incoming calls on the watch. Request READ_PHONE_STATE (and ideally READ_CALL_LOG and READ_CONTACTS) first. */
  setCallsEnabled(enabled: boolean): Promise<void>;
  /** Let the watch accept or reject a ringing call. Request ANSWER_PHONE_CALLS first. */
  setCallControlEnabled(enabled: boolean): Promise<void>;

  /** The alarms last read from or pushed to the watch (empty before the first read). */
  getAlarms(): WatchAlarms;
  /** Reads the alarms from the connected watch, stores and returns them. */
  refreshAlarms(): Promise<WatchAlarms>;
  /**
   * Pushes the alarms to the connected watch, then reads them back and resolves with what the
   * watch holds. Rejects with ERR_INVALID_ARGUMENT for bad slots (1 to 5, unique) or ranges.
   */
  setAlarms(alarms: WatchAlarmsUpdate): Promise<WatchAlarms>;

  /** Health Connect availability, granted write permissions, switch and last export. */
  getHealthConnectStatus(): Promise<HealthConnectStatus>;
  /**
   * Shows Health Connect's permission dialog for every write permission not yet granted and
   * resolves with the status afterwards. Does nothing but resolve when all are granted. After two
   * denials Android stops showing the dialog: use `openHealthConnectSettings`.
   */
  requestHealthConnectPermissions(): Promise<HealthConnectStatus>;
  /**
   * Switches the export of every later sync on or off. Switching on needs at least one granted
   * write permission and first writes everything already stored (backfill), so it can take a
   * while. Switching off leaves written records in Health Connect.
   */
  setHealthConnectEnabled(enabled: boolean): Promise<HealthConnectStatus>;
  /** Writes all stored data again (idempotent: records are replaced, not duplicated). */
  backfillHealthConnect(): Promise<HealthConnectExportResult>;
  /** Opens the Health Connect app settings, where permissions and data can be managed. */
  openHealthConnectSettings(): Promise<void>;

  /** Weather settings and the outcome of the last push. */
  getWeatherStatus(): WeatherStatus;
  /**
   * Switches weather on or off. On, with the watch connected, it pushes now and then every
   * `intervalMinutes`; the watch's own weather request is answered either way (with a
   * "weather disabled" error when off). Requests the phone's location only in `current` mode:
   * ask for ACCESS_COARSE_LOCATION first.
   */
  setWeatherEnabled(enabled: boolean): Promise<void>;
  /** Display unit on the watch. Values are always sent in °C, as Gadgetbridge does. */
  setWeatherUnit(unit: 'celsius' | 'fahrenheit'): Promise<void>;
  setWeatherLocationMode(mode: WeatherLocationMode): Promise<void>;
  /** 15 to 1440 minutes. */
  setWeatherIntervalMinutes(minutes: number): Promise<void>;
  /**
   * Searches Open-Meteo geocoding ("Bandung" or "Bandung, Indonesia") and stores the first match
   * as the city. Rejects when nothing matches or the internet is out.
   */
  setWeatherCity(query: string): Promise<WeatherPlace>;
  /** Fetches and pushes now. Rejects with what went wrong (no watch, no location, no network...). */
  refreshWeather(): Promise<WeatherStatus>;

  /**
   * The watch's watch faces (active marker, factory flag, name), with the screen size the watch
   * reported. Needs a connected watch (ERR_NOT_CONNECTED), and one that lists the watch face
   * service (ERR_UNSUPPORTED).
   */
  listWatchfaces(): Promise<WatchfaceList>;
  /**
   * Uploads a Huawei Theme Studio Pro `.hwt` package from a `file://` or `content://` URI (the
   * document picker's), as file type 1 with a random `<nine digits>_1.0.0` name, and reads the watch's
   * list afterwards. Emits `onUploadProgress` while the watch pulls the data and `onUploadResult` at
   * the end. Rejects with ERR_INVALID_ARGUMENT for a file that is no watch face or is made for another
   * screen, ERR_UPLOAD_REJECTED with the exact status code when the watch refuses, ERR_TIMEOUT when it
   * goes silent. A resolved result with `listed: false` means the watch took the upload but dropped the face.
   *
   * Signature-replay experiment: watches with the signature capability (27/01 tag 0x11 bit 8) expect a
   * Huawei signature response in the announcement (27/03 tag 0x08) and delete unsigned faces
   * seconds after activation (100014). `signature` sends a captured signature string; `fileName`
   * (`<id>_<version>`) installs under the id and version that signature was issued for instead of a
   * random name.
   */
  installWatchface(uri: string, signature?: string, fileName?: string): Promise<WatchfaceInstallResult>;
  /** Makes the face with this id active; resolves with the list read afterwards, rejects if the watch did not switch. */
  setActiveWatchface(id: string): Promise<WatchfaceList>;
  /** Deletes the face with this id; resolves with the list read afterwards, rejects if the face is still there. */
  deleteWatchface(id: string): Promise<WatchfaceList>;
  /** Parses metadata, description, and preview image from a local .hwt file. Set persist=true to keep an internal copy in app storage. */
  parseWatchfacePackage(uri: string, persist?: boolean): Promise<ParsedWatchfacePackage>;
  /** Deletes an imported watchface binary from the phone's local storage. */
  deleteLocalWatchfaceFile(filePath: string): Promise<boolean>;
  /**
   * A face's current options (DataSync 800100008). Resolves with what the watch reports; a face with no editable options does not answer
   * (ERR_TIMEOUT). ERR_NOT_CONNECTED, ERR_UNSUPPORTED (watch lacks ExpandCapability 84), ERR_INVALID_ARGUMENT (face not on the watch).
   */
  getFaceCustomization(faceId: string): Promise<FaceCustomization>;
  /**
   * Applies the parts in `config` (DataSync 800100009) and reads the face's options back. Resolves with `ok: false` and the parts the watch
   * did not take; rejects like `getFaceCustomization`. Indexes are 0-255.
   */
  applyFaceCustomization(faceId: string, config: FaceCustomization): Promise<FaceApplyResult>;

  /**
   * The watch's photo face (the face of type bit 5 in its face list), its settings and the photos it holds. Rejects with
   * ERR_UNSUPPORTED when the watch has no photo face, ERR_TIMEOUT when it does not answer.
   */
  getPhotoFace(): Promise<PhotoFace>;
  /**
   * Puts the picture at `uri` (`file://` or `content://`) on the photo face. The picture must be a PNG of exactly the watch's
   * screen size (`PhotoFace.width` x `height`): the crop screen produces it. Emits `onUploadProgress` while the watch pulls
   * the data and `onUploadResult` at the end. Rejects with ERR_INVALID_ARGUMENT for a wrong size or a full face,
   * ERR_UPLOAD_REJECTED with the watch's status code when it refuses.
   */
  addPhoto(uri: string): Promise<PhotoFace>;
  /** Removes the photo with this name (`PhotoFacePhoto.name`) from the face. */
  deletePhoto(name: string): Promise<PhotoFace>;
  /** Makes the photo face the face on the watch's screen. */
  setPhotoFaceActive(): Promise<PhotoFace>;

  /** Fall detection and SOS SMS relay state, the sleep report switch and what the watch reports for them. */
  getSafety(): SafetyStatus;
  /**
   * Sets the watch's fall detection switch. Rejects with ERR_UNSUPPORTED unless the watch reports DataSync configs and
   * SupportedCommands `0x33/01`; resolves with whether the packet went out. The state shown afterwards is the watch's own report.
   */
  setFallDetection(enabled: boolean): Promise<boolean>;
  /** Asks the watch for its fall detection switch; the answer updates `getSafety().fallSwitch`. Resolves with whether the query went out. */
  queryFallDetection(): Promise<boolean>;
  /** Lets the phone send the SMS the watch asks for (SOS). Off by default. Needs SEND_SMS (request it first); no SMS leaves the phone while off. */
  setSosRelayEnabled(enabled: boolean): Promise<void>;
  /** What an SOS request would do right now (switch, permission, SIM). Sends nothing, to nobody. */
  testSosRelay(): SosRelayTest;
  /** The morning sleep report on the watch. On by default. */
  setSleepReportEnabled(enabled: boolean): Promise<void>;
  /** Pushes the report for the latest stored night now, ignoring the once-a-morning rules. Resolves with "sent" or why not. */
  sendSleepReportNow(): Promise<string>;

  /** Satellite data (A-GPS) state: the newest download, the last delivery to the watch, what the watch asked for, the last outcome. Android only. */
  getAgps(): AgpsStatus;
  /**
   * "Update now": downloads fresh satellite data and, with a watch connected, starts the exchange from the phone so the watch takes it.
   * Without a watch the data is kept on the phone and goes out when the watch asks. Never rejects for a failed download; the outcome says what happened.
   */
  refreshAgps(): Promise<AgpsRefreshResult>;
  /** Cancels an update that is running (tells the watch "failed" so it does not wait). */
  cancelAgps(): Promise<void>;

  /** The cycle log, estimates and switches. Predictions are an average-cycle estimate. */
  getCycle(): Promise<CycleOverview>;
  /** Shows the cycle calendar on the watch (switches, capability, data when it asks). Off by default. */
  setCycleEnabled(enabled: boolean): Promise<void>;
  setCycleSwitches(switches: CycleSwitches): Promise<void>;
  /** Logs a period starting on `day` (`YYYY-MM-DD`). Rejects with ERR_INVALID_ARGUMENT when it overlaps one or another is still open. */
  startPeriod(day: string): Promise<void>;
  /** Ends the open period on `day`. */
  endPeriod(day: string): Promise<void>;
  /** Adds a finished past period. */
  addPeriod(start: string, end: string): Promise<void>;
  deletePeriod(start: string): Promise<void>;
  /** Flow and cramps of a day, 0 to 3 each. */
  logCycleDay(day: string, flow: number, cramps: number): Promise<void>;

  /**
   * Stores the day (the latest one only; JoyoRogo is the source of truth, so the day's meals are replaced, but a watch
   * quick-logged meal not yet confirmed by `markWatchMealsSynced` is kept) and, when the watch is connected, pushes the goals
   * (configs 900300023 / 900300022) and the day's meal slots (SamplePoint 600002). Also sent on every connect and when the watch
   * asks. Resolves true when it reached the watch, false when stored only. Rejects with ERR_INVALID_ARGUMENT for a bad date,
   * meal type or number.
   */
  setDietDay(day: DietDay): Promise<boolean>;
  getDietStatus(): DietStatus;
  /** Sends the stored day again (goals and meals). Resolves true when it reached the watch. */
  pushDietNow(): Promise<boolean>;
  /** JS wrote these watch-logged meals (`onWatchMealLogged`) to JoyoRogo; native stops keeping them apart. */
  markWatchMealsSynced(ids: string[]): Promise<void>;

  /**
   * Family monitoring (monitored side). Stores the config natively, or clears it (and everything native kept for it) with null.
   * Nothing is read from the watch database or sent before a config with `enabled: true` is set.
   */
  familyConfigure(config: FamilyConfig | null): Promise<void>;
  /** Builds the summary of the granted categories and posts it now. Never rejects on network errors: see `outcome`. */
  familyUploadNow(): Promise<FamilyUploadResult>;
  familyUploadStatus(): FamilyUploadStatus;

  getBodyMetrics(): BodyMetrics;
  /** Stores the set fields and, when connected, pushes the weight (event 5 dictionary 10006) and resting metabolism (500018) if they changed. */
  setBodyMetrics(update: BodyMetricsUpdate): Promise<BodyMetrics>;

  getActivityGoals(): ActivityGoalsStatus;
  /**
   * Stores the ring goals and reminders and sends them (configs 900200006..11 and the bundle 900200002); also sent on every
   * connect. The steps goal is also the profile's daily step goal. Resolves true when everything reached the watch.
   */
  setActivityGoals(goals: ActivityGoals): Promise<boolean>;
  sendActivityGoals(): Promise<boolean>;

  /** Healthy Living (P2P module `healthmodel`): the switch, whether the watch asked, the last report. */
  getHealthyLiving(): HealthyLivingStatus;
  /** On by default; takes effect on the next connect when switching on, at once when switching off. */
  setHealthyLivingEnabled(enabled: boolean): Promise<void>;
  /**
   * Sends today's tasks to the watch now, as Huawei Health does after data changes. Resolves false when the watch has not asked
   * for tasks yet (its protocol version is unknown); rejects with ERR_UNSUPPORTED when the feature is not available on the link.
   */
  pushHealthyLiving(): Promise<boolean>;

  /** The experimental running-course push (P2P module `fitness`): switch and Huawei's gates. Off by default. */
  getCourses(): CoursesStatus;
  setCoursesEnabled(enabled: boolean): Promise<void>;
  /**
   * Sends the course to the watch as a P2P file (`<id>courseInfo.bin`). EXPERIMENTAL and unverified on the wire. Rejects with
   * ERR_UNSUPPORTED while the switch is off or the watch sets neither ExpandCapability 41 nor 169, ERR_INVALID_ARGUMENT for a bad
   * course, ERR_UPLOAD_REJECTED with the watch's code when it refuses the file.
   */
  pushRunningCourse(course: RunningCourse): Promise<RunningCoursePushResult>;

  /** Whether the watch takes routes, from its ExpandCapability bits. Synchronous; all false while no watch is connected. */
  getRoutes(): RoutesStatus;
  /**
   * Sends a route to the watch: the P2P handshake (type 5, the route's name), then the simplified route as a P2P file (type 6),
   * the way Huawei Health's "Send to wearable" does. Progress arrives as `onUploadProgress`. Rejects with ERR_NOT_CONNECTED,
   * ERR_UNSUPPORTED (the watch does not set ExpandCapability 70, or has no P2P service), ERR_INVALID_ARGUMENT (bad route),
   * ERR_ROUTE_FULL (the watch's route list is full), ERR_ROUTE_NAME (name too long for the watch), ERR_UPLOAD_REJECTED (the watch
   * refused the file or the handshake failed; the message carries its code) and ERR_TIMEOUT (no handshake answer).
   */
  pushRoute(route: WatchRoute): Promise<RoutePushResult>;
}

export default requireNativeModule<HuaweiWearModule>('HuaweiWear');
