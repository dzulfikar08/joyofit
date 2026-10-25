# External sensors and phone-recorded workouts

Written 2026-10-18. Branch `sensors` (on top of `multi-watch`). **This changes native code** (a new Expo module, `modules/ble-sensors`, plus `app.json` background modes and an Android foreground service), so it changes the OTA fingerprint (docs/ota.md): it ships with a store build, together with `multi-watch`, never over the air.

JoyoFit can now take what Garmin, Strava and Wahoo apps take from the phone's side: a **Bluetooth chest strap** (heart rate, R-R intervals), **cycling sensors** (speed, cadence, power) and **running pods**, and it can **record a workout on the phone** (GPS plus those sensors) and keep it as a normal workout.

## 1. Investigation

### Which sensors, which standard

Every sensor below speaks a Bluetooth SIG GATT profile, so no vendor code is needed. The characteristic layouts are in `src/features/sensors/gatt.ts` (parsers) and are tested against the specification's flag tables.

| Service | UUID | Characteristic used | What JoyoFit takes |
| --- | --- | --- | --- |
| Heart Rate | 0x180D | 0x2A37 Heart Rate Measurement | bpm (8 or 16 bit), sensor contact, energy expended (kJ), R-R intervals (1/1024 s) |
| Cycling Speed and Cadence | 0x1816 | 0x2A5B CSC Measurement | cumulative wheel revolutions (uint32) + last wheel event time, cumulative crank revolutions (uint16) + last crank event time; both in 1/1024 s |
| Cycling Power | 0x1818 | 0x2A63 Cycling Power Measurement | instantaneous power (sint16 W), pedal power balance, wheel revolutions (time in **1/2048 s**), crank revolutions (cadence), accumulated energy; every flagged field before them is skipped correctly |
| Running Speed and Cadence | 0x1814 | 0x2A53 RSC Measurement | speed (1/256 m/s), cadence (steps/min), stride length, total distance, walking/running |
| Battery (optional) | 0x180F | 0x2A19 Battery Level | read after each connect and subscribed when the sensor can notify |
| Device Information (optional) | 0x180A | 0x2A29 Manufacturer, 0x2A24 Model | read once per connect, shown on the sensor card |

Revolution counters wrap (uint16 time every 64 s, uint16 crank counter, uint32 wheel counter); `revolutionStep` handles every wrap and reports "no step" for a repeated event (a coasting wheel repeats its last event) and for a gap longer than 10 s. A stopped wheel or crank sends no new event, so speed and cadence read 0 after 3 s without one (`COAST_TIMEOUT_MS`).

**ANT+ is out of scope.** It needs an ANT radio, which no phone sold for JoyoFit's markets has; the apps that read ANT+ need an ANT USB stick or a phone with an ANT chip. Sensors that are dual-band (most straps and power meters made since about 2015 advertise Bluetooth and ANT+ together) work here over Bluetooth; ANT+-only sensors do not. The sensor screen says so.

### Bike computers (Garmin Edge, Wahoo ELEMNT, iGPSPORT, Bryton)

A bike computer is the Bluetooth *central* that connects to sensors; to a phone it is an app companion (cloud sync, file transfer), not a sensor. It does not advertise the heart rate, speed, cadence or power services to a phone. (A few Garmin watches and straps can *broadcast* heart rate as a standard 0x180D peripheral: such a device pairs here like any strap. Not tested.) The realistic integration is the activity file or the vendor's cloud:

| Route | State |
| --- | --- |
| **FIT file import** (Workouts tab, "Import FIT file"; `src/features/fitimport`) | Exists and is the right answer for every bike computer: Garmin Edge (Garmin Connect export, or the file from the device), Wahoo ELEMNT, iGPSPORT and Bryton all write FIT. It reads heart rate, GPS, altitude, speed, cadence, power, stride and laps (`parseFit.ts`), and the Android/iOS share sheet opens `.fit` files straight into it (`plugins/with-shared-fit.js`, document types in `app.json`). Duplicates are caught by start and overlap. |
| **Strava** | The existing link is **push-only**: JoyoFit uploads (`POST /uploads`) and reads back only the upload's own status. There is no `GET /activities` in the app or in `server/`, and the webhook says "Activity events are acknowledged and ignored; JoyoFit never reads Strava activities" (`server/src/strava.ts`). An import from Strava would need the `activity:read` scope, server work and a look at Strava's API terms on re-using activity data. |
| **Garmin Connect** | The Garmin Connect Developer Program (Activity API) is open to businesses only, after Garmin approves an application ([developer.garmin.com/gc-developer-program](https://developer.garmin.com/gc-developer-program/)). Needs a server-side OAuth connection and a webhook receiver. Follow-up. |
| **Wahoo Cloud API** | OAuth 2.0 plus a "Cloud Request and Approval" step on Wahoo's developer portal before an app gets access ([developers.wahooligan.com/cloud](https://developers.wahooligan.com/cloud)). Gives the workout history and the FIT files. Follow-up. |

**Recommendation (what this branch builds): Bluetooth sensors and phone recording now; FIT import stays the bike-computer route; Garmin Connect / Wahoo cloud / Strava import are follow-ups** that need accounts with those companies and server work, not app work. Nothing in the data model blocks them: an imported workout is the same `workouts` row (`imported = 1`) a FIT import makes today.

### Native Bluetooth: reuse or a new module?

Looked at both existing stacks and chose **a new small module, `modules/ble-sensors`**, with no third-party BLE library.

- Android `BleTransport.kt` and iOS `BleTransport.swift` are hard-wired to the Huawei protocol: one service (0xFE86 / FE01 / FE02), a framed packet stream (`WatchTransport`), HiChain framing, write flow control, ANCS. The GATT mechanics are generic (retry, status texts, API 33 callback overloads, descriptor writes), and I used them as the pattern, but the class cannot subscribe to a standard characteristic, and `BleCentral.routes` on iOS only routes to `BleTransport`.
- Sharing the iOS central would couple the sensors to the one global watch link and to `restoreIdentifier`; a second `CBCentralManager` (own queue, no restore id) is supported by CoreBluetooth and leaves the watch code untouched. On Android several `BluetoothGatt` clients coexist anyway.
- The need is seven characteristics. `react-native-ble-plx` would add a native dependency (a new fingerprint input, its own permission handling), a JS-side GATT API to wrap anyway, and it still would not give the foreground service, the GPS stream and the background modes this feature needs, which are the hard part. The module is about 2000 lines of Kotlin and Swift, of which the logic that matters is two small pure files per platform with tests.
- **The native layer never parses a payload.** It forwards the raw characteristic value as hex with a radio timestamp; the parsers are shared TypeScript (`gatt.ts`), tested once with `bun test` instead of twice in Kotlin and Swift. The cost is that JS has to be running to parse: on Android the foreground service plus a wake lock keep it running, on iOS location updates (outdoor) or Bluetooth events (indoor) keep the process alive; the sampler catches up by timestamp when JS was throttled, see 3.

### Background survival

| | Screen locked, workout running |
| --- | --- |
| Android | `RecordingService`, a foreground service of type `location` (outdoor) and `connectedDevice` (when Bluetooth is permitted), an ongoing notification (elapsed time, distance, heart rate) and a partial wake lock. No `ACCESS_BACKGROUND_LOCATION`: a location foreground service started while the app is visible keeps location access, which is also what Play expects. Needs the Play Console foreground service declaration for `location` and `connectedDevice`. |
| iOS outdoor | `UIBackgroundModes` gains `location` (it already had `bluetooth-central`); `CLLocationManager.allowsBackgroundLocationUpdates` with the blue status-bar pill. When-in-use authorization is enough for a session started in the foreground; no "Always" prompt. |
| iOS indoor / strength | `bluetooth-central` only: iOS wakes the app for every notification of a connected peripheral. JS may not run between wakes, so the sampler fills the seconds by timestamp (`Recorder.tick`). **Not verified on a device**, see section 6. |

When Android refuses the foreground service (`ERR_SERVICE_NOT_ALLOWED`: a start from the background, a missing type permission, no start within 10 s), `WorkoutSession.start` no longer gives up: the GPS fixes and the wake lock start anyway (`SessionPolicy`, unit-tested in `SessionPolicyTest`), `RecordingService` stops itself without ending the session, no notification is posted, and the call rejects only afterwards. The controller treats that as `noService` and the Ready and Live screens show "Layar mati bisa menghentikan rekaman ..." instead of silently recording without GPS, which is what it did before.

`app.json` also reworded `NSBluetoothAlwaysUsageDescription`, `NSBluetoothPeripheralUsageDescription` and `NSLocationWhenInUseUsageDescription` (they spoke of the watch only). docs/app-store.md and docs/play-store.md carry the review notes.

## 2. Data

- **Sensors:** table `sensor` (`id` = the radio id: Android MAC, iOS peripheral UUID; name, alias, kinds, battery, manufacturer, model, `auto_connect`), created from JS like `strength_record` (`ensureSensorSchema`). No shared migration: no native code reads it, so `joyofit-db-migrations.json`, the Kotlin and Swift writers and the fingerprint inputs of the database stay as `multi-watch` left them.
- **Attribution (consistent with the multi-watch `device` column):** one workout has at most one source per channel, so attribution is per workout and sensor, not per sample: table `workout_sensor (workout_id, sensor_id, name, kinds)` plus `summary_json.sensors` (so the names survive a cloud restore). `workouts.device` stays NULL for a phone recording: that column means "the watch that recorded it" and the native watch paths filter on it.
- **A phone workout is a normal workout:** `workouts` row with `imported = 1` (so the native Health Connect / Apple Health export, `syncStart`, cross-watch dedup and the automatic Strava upload, which all read `imported = 0` watch rows, leave it alone), `summary_json.source = 'phone'`, samples in `workout_points` (ts, lat, lon, alt, hr, speed, cadence, stride, power at 1 Hz), one HR value per minute in `step_samples` (what Strain and Trends read), laps in `summary_json.laps`. HR zones, charts, splits, laps, training effect and strain are the existing analysis over those rows.
- **Crash journal:** `recording_state` + `recording_journal` (session `phone` or `strength`): samples are appended every 10 s; after a kill the recording comes back paused and is saved or discarded from the Workouts tab.

## 3. The recorder

`src/features/record/recorder.ts` is a pure state machine (idle, recording, paused, finished) that never reads a clock: every call takes the instant in ms. `tick(now)` writes a sample for every whole second since the last one, carrying the latest readings forward, so a throttled JS thread loses no seconds. Rules, all tested in `recorder.test.ts`:

- GPS fixes with accuracy over 35 m are ignored; a jump faster than 12 m/s on foot (28 m/s on wheels) is ignored, and five jumps in a row re-anchor the path; a fix reporting under 0.4 m/s adds nothing; a pause adds no distance and the first fix after it is only an anchor.
- Distance per second, by source: a bike with a speed sensor uses the wheel (revolutions x the wheel size, Settings in the sensor screen), else GPS; on foot outdoors GPS; indoors a foot pod's speed; indoors without sensors there is no distance.
- Heart rate and power are held for 5 s, speed and cadence from revolution counters read 0 after 3 s without a new event.
- **Energy:** from the heart rate (Keytel et al. 2005, the same equation the watch-link live session uses) when the strap covers at least half of the time, else MET x weight x time. `summary_json.kcalSource` says which.
- Laps, moving time that excludes pauses, normalized power (30 s rolling), max speed (3 s smoothed).

`controller.ts` wires it to the hub and the native session (warm-up and prepare = GPS and sensor connect, start, pause, lap, finish = save, restore after a kill); `state/RecorderProvider.tsx` is its React shell.

### Getting a GPS fix quickly

A fix is slow when the GPS starts late and listens to one source, so both were changed (the owner saw "finding location" take noticeably longer than Huawei Health on a Xiaomi 2506BPN68G, Android 16):

- **It starts when the picker opens, not at "Mulai".** Before, the native GPS only began inside `prepare`, i.e. after choosing the sport, tapping "Mulai", and the foreground service start (awaited) on the second screen. Now `RecordScreen > SetupView` calls `useGpsWarmUp`: for an outdoor sport whose precise location is already allowed (it never asks) the controller's `warmUp` starts the same native session with GPS at once, and `GpsLine` shows the signal under the sport chips. `prepare` takes the running session over (no second start, the fix is kept). `stopWarmUp` ends it when the picker loses focus (the sensors page opens over it), the app leaves the foreground (screen off included), the sport has no GPS, or the picker closes without a recording; changing between outdoor sports keeps the session. Android shows the recording notification and holds the wake lock during the warm-up, iOS the location pill; both end with it.
- **Android uses the fused provider** (`WorkoutLocation.kt`): on Android 12+ the system's `FUSED_PROVIDER` at `QUALITY_HIGH_ACCURACY`, 1 s, which gives a Wi-Fi/cell position within a second or two and then GNSS accuracy; before 12, or without a fused provider, the raw GPS provider as before. It is the framework API, so there is no Play services dependency and Huawei phones without GMS fall back by themselves. A last known location is still never delivered into a workout. iOS already used `kCLLocationAccuracyBest`.
- **"Ready" at 25 m, usable at 35 m.** `gpsStatus`: `ready` at a fix of 25 m or better, or at 25-35 m once the fixes have held for 4 s (`fair`, "Sinyal GPS sudah cukup", until then); worse than 35 m is `weak` (the recorder ignores those). "Mulai" is never disabled: the track starts at the first fix the recorder accepts and accuracy keeps improving while it records.

Measured on the Xiaomi 2506BPN68G (Android 16, `dumpsys location`, `=MI GLP=` log): the GNSS itself is fast, a time to first fix of 4.7 s on the phone's own log of an earlier recording and a mean of 4.6 s over 44 fixes in the system KPI, and the last Wi-Fi/network position had 20 m accuracy; with the picker of the build from before this change open, the GPS provider read `ProviderRequest[OFF]` and the latest JoyoFit GPS registration was hours old, so the whole wait counted from "Mulai". Not verified on hardware (the installed JoyoFit build predates the change): the time to "ready" with the warm-up and the fused provider, and how long Xiaomi's notification and battery policies let the warm-up run.

### Getting back to a live recording

One definition of the live screen, `src/features/record/liveRoute.ts` (route `/workouts/record`, link `joyofit://workouts/record`, pure, tested). The notification, the pill, the card and back all use it.

- **Notification tap.** `RecorderProvider` passes the link as `openUrl` in the `WorkoutSessionOptions` of `startWorkoutSession`; `WorkoutSession` keeps it with the title and text (so `update` rebuilds the notification with it) and `RecordingNotification` opens it as a VIEW intent for this app (`NotificationTarget.viewUrl`, JVM-tested: another scheme or a blank value gives the launcher intent as before). Native change: needs a new APK; iOS ignores `openUrl`.
- **Lock screen, live clock, buttons (Android).** The notification used to sit on a LOW channel (hidden on the lock screen unless "show silent notifications" is on) and carried the time as text, which only JS updated, so it stood still with the screen off. Now: channel `recording_v2` at `IMPORTANCE_DEFAULT` with public lock-screen visibility, no sound, no vibration, no badge (a channel's importance cannot change after creation, so `workout_recording` is deleted when the new one is made); `setOngoing`, `setOnlyAlertOnce`, `setVisibility(PUBLIC)`, category workout (Android 12+, service before). The time is a chronometer (`setUsesChronometer` + `setWhen`), so it ticks with no update; while paused it is frozen text ("Dijeda · 1:02:05 · ...") instead. JS reports the recorder's clock, distance and heart rate (`updateWorkoutSession({ movingSec, distanceM, hr, paused })`) on start, pause, resume and every 15 s; between reports `RecordingProgress` adds the distance from the GPS fixes the service sees itself (accuracy <= 25 m, steps >= 3 m, not while paused) and `WorkoutSession` re-posts every 15 s, so a throttled JS thread leaves it counting. The next report replaces the estimate. Buttons: Pause + Lap while recording, Resume while paused (texts come from JS in `WorkoutSessionOptions.controls`, also the locale for the decimal separator); a press is a `PendingIntent` to `RecordingService`, which emits `onWorkoutAction` and JS calls the same `pause`/`resume`/`lap` as the live screen. All of it decided in `RecordingNotificationSpec` (no Android objects, JVM-tested in `RecordingNotificationSpecTest` and `RecordingProgressTest`). Native change: ships with the next store build, no OTA. Not verified on a device.
- **Pill on every tab.** `LivePill` is drawn by the root `tabBar` directly above the tab bar (it takes layout space, never covers content). Hidden while idle, on the live screen and where the tab bar is hidden (onboarding). The Workouts tab pins the `RecordingBanner` outside its list.
- **Back.** While a recording is prepared or running, the Workouts stack is `[index, record]`: `router.navigate(LIVE_ROUTE, { withAnchor: true })` builds it when the stack does not exist yet, and `RecordScreen` reshapes a stack that does (live screen alone, or on top of Manual entry or a workout detail) with `anchorLiveStack`. Back (hardware, header, iOS swipe) is then a plain pop onto the Workouts list. Nothing intercepts the pop: `beforeRemove` cannot stop an iOS swipe (the native screen is already gone) and `usePreventRemove` is SDK 58+. `navigate` reuses a live screen that is already on top, so repeated taps never stack copies. Save (`replace` to the detail) and discard (`back` / `replace('/workouts')`) are untouched.

### A sensor that sleeps (XOSS Vortex) and the ride without cadence

Evidence (Xiaomi 2506BPN68G, Android 16, `adb logcat`, app 1470734): the Vortex (CSC `1816`: `2a5b` notify, `2a5c`, `2a5d`, `2a55`; plus a Nordic UART service) sends crank-only frames in cadence mode (`BtGatt.GattService: onNotify handle=22 length=5` = flags `02` + crank revolutions + crank time). The Manage screen showed rpm while the crank was turned by hand, so the parser and the cadence maths are right. The sensor requests a 750 ms connection interval with a 4 s supervision timeout and drops its link (`GATT status 8`) when it dozes off; it advertises again only once the crank moves. A ride recorded with it had no cadence and the workout did not list the sensor: no value ever reached the recorder, so the link was not up during the ride.

- **The recording keeps looking for its sensors for the whole session.** `RecordingController.superviseSensors` (every tick, in `ready` and `active`, also paused) restarts the link of a sensor it sees down after 3 s, then 6, 12, 24 and every 30 s, never giving up; the native link's own backoff continues in between. `SensorHub.connect` restarts a link that is down and waiting out its delay (`disconnect` then `connect`), so "Sambungkan" and the start of a recording act at once. Values are taken whenever the sensor is back. Tested with a fake radio: a sensor that only appears 30 s after "Mulai", one that drops and returns, one that never shows up (`sensorSession.test.ts`).
- **Say what happened.** The log (Settings, Advanced) gets one line per link change and the first value of each characteristic with its raw hex (`sensor X: first 2a5b value 02...`). The workout's `summary_json.sensors` keeps `frames` and the CSC `mode` per sensor; a sensor that was asked for and never sent a value is listed as "no data received" with a note on the workout.
- **Modes.** `SensorTracker.cscMode` reads the flags of the frames (wheel only = `speed`, crank only = `cadence`, both). A speed-mode sensor reports wheel revolutions only, so the row says "Sensor dalam mode kecepatan" with how to switch it; its numbers are used for speed.
- **Status everywhere.** `SensorLinkRow` (Watch tab, picker, ready and live screens) shows connected / connecting / searching, battery, mode, whether data comes in and the age of the last value, a short "sensor not found, turn the pedals" message, and one button (Sambungkan / Batal / Putuskan; no Putuskan for a sensor the recording runs). The live screen shows the cadence beside the heart rate on a bike.
- **Glitch guards.** A crank step over 250 rpm or a wheel step over 40 m/s (a counter that restarted) is ignored; a slow crank holds its value up to 5 s before it reads 0.

### The phone's own step counter (cadence and steps without a pod)

A run, walk or hike recorded on the phone gets cadence (steps per minute) and a step count from the phone's step counter when no running pod reports. Before, only a paired pod gave them: with none, `cadence` was empty and `workouts.steps` was 0.

- **What is read.** Android: `Sensor.TYPE_STEP_COUNTER` (cumulative steps since boot, one event per change; `WorkoutSteps.kt`). The pure part (`StepCounterLogic.kt`: the sensor's elapsed-realtime clock to wall-clock time, steps since the session started, a counter that goes backwards after a reboot keeps what was counted) has a unit test (`StepCounterLogicTest`). iOS: `CMPedometer.startUpdates(from:)` (`WorkoutSteps.swift`), steps since the session started, an update about every second or two while walking. Both arrive as the module event `onSteps` `{ ts, steps }`.
- **When it runs.** Only for `run`, `walk` and `hike`, and only when the workout session is started with `steps: true`, which `RecordingController` does when `BleSensors.stepCounterPermission()` says `granted` at the start (it never blocks starting). It starts and stops with the session, next to the GPS. A phone without the sensor, or without the permission, simply has no steps: nothing throws and the ready screen shows a short hint.
- **Also on the live screen of a workout started on the watch (JRG-418).** `startLiveSteps()` / `stopLiveSteps()` run a second counter of the same code (`LiveSteps` in `WorkoutSteps.kt`, `WorkoutSteps.live` in Swift), with its own event `onLiveSteps`, without a workout session; the counting rules are shared (`sensors/phoneSteps.ts` `PhoneStepCount`, which `Recorder` now uses too). When and why: `docs/live-run.md`, "Figures added on the phone".
- **Permission.** Android 10+: `ACTIVITY_RECOGNITION` (declared in the module's manifest, asked at runtime by `ensureStepCounter()` through `PermissionsAndroid`; below Android 10 there is no runtime permission). iOS: the system motion prompt (`NSMotionUsageDescription` in `app.json`), raised by the first pedometer use (`requestStepCounterPermission()` runs a one-second query for it). `PermissionGate` shows an optional card "Hitung langkah dan kadens dari HP" on the setup screen of a foot sport; a refusal never blocks "Mulai", it leaves a short note and a recording without phone cadence.
- **How the numbers are made (`Recorder`).** `steps(count, ts)` keeps the readings of the last seconds. Cadence of a sample = (newest reading of the last 10 s minus the oldest) / time between them x 60, rounded, with at least two readings 4 s or more apart; 0 when the counter did not move over that span or has been silent for 4 s (the Android counter only reports changes, so silence is a stop); empty when there is no reading in the last 10 s, and above 260 steps per minute it is dropped, not clamped. A running pod's cadence always wins when present. The workout's `steps` is the counter difference between the first reading after "Mulai" and the last, without the steps counted while paused; with pod cadence the old accumulation (`cadence / 60` per second) stays. A counter that goes backwards (Android reboot) restarts the baseline without subtracting. `avgCadence`, `maxCadence` and the lap averages include the phone cadence. The total is in the crash journal (`RecorderMeta.phoneSteps`), so a restored recording keeps it.
- **Not done.** No stride from the pedometer in the recording: `workout_points.stride` stays empty, the analysis derives the step length from speed and cadence (the live views show distance over steps as "Stride length"). Both counters count the steps *of the phone*, so the accuracy depends on where it is carried (trouser pocket and armband are good, in a hand that swings or a bag with the phone moving about, much worse; pushing a pram undercounts), and on a very slow walk the counter may report in bursts, so the first seconds of a recording and a restart after a stop have no cadence yet. Steps taken during a pause that arrive in the first reading after "Lanjut" are counted (the counter does not say when a step happened inside a reading).
- **Needs a new build.** A new permission in the manifest and native code on both platforms: it ships with a store build, not over the air (docs/ota.md).
- **Verification.** TypeScript and the Kotlin logic are unit tested (`recorder.test.ts`, `controller.test.ts`, `hub.test.ts`, `StepCounterLogicTest.kt`). `WorkoutSteps.kt` and **all of the Swift (`WorkoutSteps.swift`, the module wiring) are uncompiled and untested on a device**: the Swift was written without a compiler, check it with the first iOS build, and test on a phone that a walk with no pod fills the cadence chart and the step total.

## 4. Export and follow-ups

- **FIT** (`src/features/strava/activityFile.ts`): records now carry cadence (foot sports as strides per minute, as FIT counts them), speed (16-bit and enhanced), power and heart rate; session and lap carry average/max power, normalized power and cadence; a workout with several laps writes one lap message per lap (the last one ends the session); without GPS the distance follows the per-sample speed instead of a straight line. Watch workouts that already had per-sample speed/cadence/power columns now send them too (the fields are only written when a sample has them).
- **Strava:** a phone workout goes through the same upload (`sendWorkoutToStrava`); the finish dialog sends it when Strava is connected. These rows are `imported = 1`, so the watch auto-upload never touches them and nothing is sent twice.
- **JoyoRogo:** the energy goes to the diary with `exercise.upsertJoyofit` (external id `phone:<start>`, type `lari`/`jalan_cepat`/`sepeda`/`latihan`), remembered in `phone_kcal_sent`, retried in the sync (`retryPhoneKcal`), under the same "automatic sync / Wi-Fi only" settings as the strength logger. The Pro workout document (`pushWorkouts`) picks the workout up from the data change like any row.

## 5. Strength logger

When a paired heart rate strap is connected during a strength session the logger records HR (journal session `strength`), shows it in the header and uses heart-rate energy instead of MET (`kcalSource: 'hr'`, pushed to JoyoRogo like an estimate). A watch workout that merges later still wins, as before. The native workout session (foreground service) is started for the session so Android keeps the Bluetooth link alive with the screen locked.

**Watch workouts** (a Huawei watch taking an external strap) are not built: the watch would need the strap through Huawei's own protocol, which JoyoFit does not speak and which Huawei does not document for third-party sensors. Not planned.

## 6. Tests

| What | Where | Run |
| --- | --- | --- |
| GATT parsers (HR flags 8/16-bit, RR, energy, contact; CSC wheel/crank; power flags; RSC), rollover math, stream tracker | `src/features/sensors/gatt.test.ts` | `bun test ./src/` |
| Sensor hub (scan results, links, battery/info, throttling) | `src/features/sensors/hub.test.ts` | same |
| Recording state machine, GPS rules, sensors, laps, restore | `src/features/record/recorder.test.ts`, `controller.test.ts` (fakes for hub, native session and the real schema in memory), `save.test.ts` | same |
| FIT export with sensor channels and laps | `src/features/strava/activityFileSensors.test.ts` (decoded with Garmin's SDK) | same |
| JoyoRogo energy plan | `src/cloud/phoneKcalPlan.test.ts` | same |
| Kotlin: GATT plan table, backoff and the step counter logic | `modules/ble-sensors/android/src/test` | `cd android && ./gradlew :ble-sensors:testDebugUnitTest` (CI runs it with huawei-wear) |
| Swift: the same two pure files | `modules/ble-sensors/ios/SensorLogicTests` | `export PATH=$HOME/.local/swift-6.4/usr/bin:$PATH; cd modules/ble-sensors/ios/SensorLogicTests && swift test` (CI: swift-logic job) |

## 7. What is not verified (needs a device)

Nothing in the native module ran on hardware: the GATT sequence with real straps and sensors, reconnect after going out of range, the Android foreground service types on API 29/30 and 34+, notification display, scanning on Android below 12 (needs Location services on), the iOS prompts and background behaviour (CoreBluetooth wake-ups with the screen locked for indoor sessions, the location pill, relaunch). The CoreBluetooth and CoreLocation Swift files type-check against the iPhoneOS SDK but cannot build or run on Linux.

### Device test script (owner)

Needs a chest strap (Polar H10/H9, Wahoo TICKR, Garmin HRM-Dual, Coospo ...), and if possible a speed/cadence sensor or a power meter, ideally a foot pod. Install the CI build of branch `sensors` over the Play build with `adb install -r` (never uninstall; the watch pairing stays).

1. **Pair a strap.** Watch tab > Sensor > Tambah sensor > Lanjut. Wet the strap's electrodes, put it on. The strap appears with a heart tag; Pasangkan. Expect: name, a bpm line within a few seconds, battery %, manufacturer and model once read. Rename it, switch auto-connect off and on.
2. **Reconnect.** Take the strap off for 20 s: the card shows the link lost, then recovers by itself after you put it back (no tap). Walk out of range and back.
3. **Cycling sensor / power.** Pair it (spin the crank or wheel to wake it). Expect speed/cadence or watts in the live line. Set the wheel size (Ukuran roda) to your tyre.
4. **Indoor workout.** Workouts > Rekam latihan > Sepeda dalam ruangan (or Lari treadmill with a pod): Mulai. Expect connect states, then time, speed, cadence, power, heart rate and a zone colour. Lap twice, pause 30 s, resume, finish. In the detail: HR zones, power/cadence charts, laps, "Direkam oleh HP + sensor". Export: send to Strava and open the file there (HR, cadence, power, laps present).
5. **Outdoor run/ride.** Rekam latihan > Lari: allow location (Lanjut), wait for "GPS siap", Mulai, lock the screen and put the phone in a pocket for 10 minutes while walking/running a loop. Expect: the notification (Android) with time and distance still counting; on return the distance and route are complete, no gap, no hole in heart rate. Repeat with the phone left on a table for 5 minutes with the screen off (Android with battery saver on, and iOS) to see whether it keeps recording.
6. **Kill test.** During a recording swipe the app away (or force-stop it), reopen: the Workouts tab offers the recording, paused, with its samples; resume and finish.
7. **Strength with a strap.** Strength > start a session with the strap connected: HR chip in the header; finish the session: the summary shows heart-rate energy, HR zones appear in the detail, and the energy reaches JoyoRogo.
8. **No sensor.** Record a walk with no sensor paired: GPS only, energy by MET, no sensor rows, nothing nags.
9. **Permissions.** Deny location, then Bluetooth: each shows a notice with a settings button and the rest still works. On iOS check the Bluetooth prompt appears only after Lanjut.
10. **Watch still fine.** Seiya-B29F (Watch Fit 4) still connects and syncs afterwards; a workout started on the watch still mirrors on the phone.
